"""Load docs/KNOWLEDGE_BASE_DRAFT.md into a business's knowledge (docs/KNOWLEDGE_AND_AI_PLAN.md).

Each "## N. Title" section is one document; section 11 is the conversation guide (type "guide"). A document with the
same title is updated when its text changed (and its chunks rebuilt); new sections are added. Nothing is deleted.

On the API server (the image has no docs/ folder, so the script is copied in and the draft is piped):
    docker compose -f deploy/api/compose.yml cp scripts/load_knowledge.py api:/tmp/load_knowledge.py
    docker compose -f deploy/api/compose.yml exec -T api python /tmp/load_knowledge.py --business <id> \
        < docs/KNOWLEDGE_BASE_DRAFT.md
"""
from __future__ import annotations

import argparse
import os
import re
import sys

sys.path.insert(0, os.getcwd())  # run as a file inside the container: find the app package in the working directory

def sections(markdown: str) -> list[dict]:
    parts = re.split(r"^## (\d+)\. (.+)$", markdown, flags=re.M)
    docs = []
    for i in range(1, len(parts), 3):
        number, title, body = int(parts[i]), parts[i + 1].strip(), parts[i + 2].strip().rstrip("-").strip()
        guide = number == 11
        docs.append({"title": "Conversation guide" if guide else title, "source_type": "guide" if guide else "manual",
                     "content": body})
    return docs


def main(business_id: str, markdown: str) -> None:
    from app.database.client import supabase
    from app.database.knowledge import (create_knowledge_document, delete_knowledge_chunks,
                                        update_knowledge_document)
    from app.services.knowledge_ingestion import ingest_knowledge

    existing = {row["title"]: row for row in (supabase.table("knowledge_documents").select("id,title,content,source_type")
                                              .eq("business_id", business_id).execute().data or [])}
    for doc in sections(markdown):
        row = existing.get(doc["title"])
        if row and row.get("content") == doc["content"] and row.get("source_type") == doc["source_type"]:
            print("same", doc["title"])
            continue
        if row:
            update_knowledge_document(row["id"], doc["title"], doc["content"], doc["source_type"])
            delete_knowledge_chunks(row["id"])
            print("updated", doc["title"], len(ingest_knowledge(row["id"], doc["content"])))
        else:
            created = create_knowledge_document(business_id=business_id, title=doc["title"],
                                                source_type=doc["source_type"], content=doc["content"])
            print("added", doc["title"], len(ingest_knowledge(created["id"], doc["content"])))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--business", required=True)
    args = parser.parse_args(sys.argv[1:])
    main(args.business, sys.stdin.read())
