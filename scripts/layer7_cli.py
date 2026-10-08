from __future__ import annotations
import argparse
import json
import os
import sys
from typing import Sequence
import httpx


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="layer7", description="FayFort Layer 7 local channel and control-plane utilities.")
    commands = parser.add_subparsers(dest="command", required=True)
    simulate = commands.add_parser("simulate-manual", help="send one normalized manual-channel message")
    simulate.add_argument("--base-url", default=os.getenv("LAYER7_API_BASE_URL", "http://127.0.0.1:8001"))
    simulate.add_argument("--business-id", required=True)
    simulate.add_argument("--customer-external-id", required=True)
    simulate.add_argument("--provider-event-id", required=True)
    simulate.add_argument("--content", required=True)

    for name in ("connections-list", "connections-create", "connections-pause", "connections-resume", "connections-disconnect"):
        command = commands.add_parser(name, help=f"{name.replace('-', ' ')} for an authorized business")
        command.add_argument("--base-url", default=os.getenv("LAYER7_API_BASE_URL", "http://127.0.0.1:8001"))
        command.add_argument("--business-id", required=True)
        if name == "connections-create":
            command.add_argument("--provider", required=True)
            command.add_argument("--display-name", required=True)
            command.add_argument("--safe-settings", default="{}", help="JSON containing only allowlisted non-secret settings")
        elif name != "connections-list":
            command.add_argument("--connection-id", required=True)

    for name in ("automations-list", "automations-create", "automations-enable", "automations-disable", "automations-dry-run", "automations-execute"):
        command = commands.add_parser(name, help=f"{name.replace('-', ' ')} for an authorized business")
        command.add_argument("--base-url", default=os.getenv("LAYER7_API_BASE_URL", "http://127.0.0.1:8001"))
        command.add_argument("--business-id", required=True)
        if name == "automations-create":
            command.add_argument("--name", required=True)
            command.add_argument("--trigger-type", choices=("manual_test", "conversation_inbound"), default="manual_test")
            command.add_argument("--conditions", default="{}", help="JSON using allowlisted condition keys")
        elif name != "automations-list":
            command.add_argument("--automation-id", required=True)
            if name in {"automations-dry-run", "automations-execute"}:
                command.add_argument("--idempotency-key", required=True)
                command.add_argument("--trigger-id")
                command.add_argument("--conversation-id")

    events = commands.add_parser("events-list", help="read sanitized business activity events")
    events.add_argument("--base-url", default=os.getenv("LAYER7_API_BASE_URL", "http://127.0.0.1:8001"))
    events.add_argument("--business-id", required=True)
    events.add_argument("--after-id", type=int, default=0)
    events.add_argument("--limit", type=int, default=100)
    for name in ("handoffs-list", "handoffs-request", "handoffs-assign", "handoffs-take-over", "handoffs-return", "handoffs-reply"):
        command = commands.add_parser(name, help=f"{name.replace('-', ' ')} for an authorized business")
        command.add_argument("--base-url", default=os.getenv("LAYER7_API_BASE_URL", "http://127.0.0.1:8001"))
        command.add_argument("--business-id", required=True)
        if name == "handoffs-list":
            command.add_argument("--status", choices=("requested", "assigned", "active", "returned", "resolved", "cancelled"))
        elif name == "handoffs-request":
            command.add_argument("--conversation-id", required=True)
            command.add_argument("--reason", default="customer_requested")
        else:
            command.add_argument("--handoff-id", required=True)
            if name == "handoffs-assign": command.add_argument("--agent-id", required=True)
            if name == "handoffs-reply": command.add_argument("--content", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    access_token = os.getenv("FAYFORT_ACCESS_TOKEN")
    if not access_token:
        print("Set FAYFORT_ACCESS_TOKEN to a valid Supabase access token for an active business member.", file=sys.stderr)
        return 2
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        if args.command == "simulate-manual":
            response = httpx.post(f"{args.base_url.rstrip('/')}/channels/manual/inbound", json={"business_id":args.business_id, "customer_external_id":args.customer_external_id, "provider_event_id":args.provider_event_id, "content":args.content}, headers=headers, timeout=90)
        elif args.command.startswith("connections-"):
            base = f"{args.base_url.rstrip('/')}/businesses/{args.business_id}/connections"
            if args.command == "connections-list": response = httpx.get(base, headers=headers, timeout=30)
            elif args.command == "connections-create": response = httpx.post(base, json={"provider":args.provider, "display_name":args.display_name, "safe_settings":json.loads(args.safe_settings)}, headers=headers, timeout=30)
            else: response = httpx.post(f"{base}/{args.connection_id}/{args.command.removeprefix('connections-')}", headers=headers, timeout=30)
        elif args.command.startswith("automations-"):
            base = f"{args.base_url.rstrip('/')}/businesses/{args.business_id}/automations"
            if args.command == "automations-list": response = httpx.get(base, headers=headers, timeout=30)
            elif args.command == "automations-create": response = httpx.post(base, json={"name":args.name, "trigger_type":args.trigger_type, "action_type":"record_test_run", "conditions":json.loads(args.conditions)}, headers=headers, timeout=30)
            elif args.command in {"automations-enable", "automations-disable"}: response = httpx.patch(f"{base}/{args.automation_id}", json={"enabled":args.command.endswith("enable")}, headers=headers, timeout=30)
            else:
                action = "dry-run" if args.command == "automations-dry-run" else "execute"
                response = httpx.post(f"{base}/{args.automation_id}/{action}", json={"idempotency_key":args.idempotency_key, "trigger_id":args.trigger_id, "conversation_id":args.conversation_id}, headers=headers, timeout=30)
        elif args.command == "events-list":
            base = f"{args.base_url.rstrip('/')}/businesses/{args.business_id}/events"
            response = httpx.get(base, params={"after_id":args.after_id, "limit":args.limit}, headers=headers, timeout=30)
        else:
            base = f"{args.base_url.rstrip('/')}/businesses/{args.business_id}/handoffs"
            if args.command == "handoffs-list": response = httpx.get(base, params={"status":args.status} if args.status else None, headers=headers, timeout=30)
            elif args.command == "handoffs-request": response = httpx.post(base, params={"conversation_id":args.conversation_id}, json={"reason":args.reason}, headers=headers, timeout=30)
            elif args.command == "handoffs-assign": response = httpx.post(f"{base}/{args.handoff_id}/assign", json={"agent_id":args.agent_id}, headers=headers, timeout=30)
            elif args.command == "handoffs-take-over": response = httpx.post(f"{base}/{args.handoff_id}/take-over", headers=headers, timeout=30)
            elif args.command == "handoffs-return": response = httpx.post(f"{base}/{args.handoff_id}/return-to-automation", headers=headers, timeout=30)
            else: response = httpx.post(f"{base}/{args.handoff_id}/messages", json={"content":args.content}, headers=headers, timeout=30)
    except json.JSONDecodeError:
        print("The JSON option must contain valid JSON.", file=sys.stderr)
        return 2
    except httpx.HTTPError as exc:
        print(f"Could not reach the FayFort API ({type(exc).__name__}).", file=sys.stderr)
        return 1
    try: body = response.json()
    except ValueError: body = {"detail":"API returned a non-JSON response."}
    print(json.dumps(body, indent=2, ensure_ascii=False))
    return 0 if response.is_success else 1

if __name__ == "__main__":
    raise SystemExit(main())
