from __future__ import annotations
from fastapi import APIRouter, Header, HTTPException
from app.database.automations import create_automation, list_automations, list_executions, set_automation_enabled
from app.automations.service import run_automation
from app.directory.identity import has_trusted_business_identity
from app.database.events import publish_business_event
from app.schemas.automation import AutomationCreate, AutomationEnable, AutomationRunRequest


def create_automations_router() -> APIRouter:
    router = APIRouter(prefix="/businesses/{business_id}/automations", tags=["automations"])
    def authorize(business_id: str, authorization: str | None) -> None:
        if not has_trusted_business_identity(authorization, business_id):
            raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")

    @router.get("")
    def get_automations(business_id: str, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try: return {"automations": list_automations(business_id)}
        except Exception: raise HTTPException(status_code=503, detail="Automations could not be loaded.")

    @router.post("", status_code=201)
    def add_automation(business_id: str, payload: AutomationCreate, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try:
            automation = create_automation(business_id, payload.model_dump())
            publish_business_event(business_id, "automation.created", "business_automation", str(automation["id"]))
            return {"automation": automation}
        except Exception: raise HTTPException(status_code=503, detail="Automation could not be created.")

    @router.patch("/{automation_id}")
    def enable_automation(business_id: str, automation_id: str, payload: AutomationEnable, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try: automation = set_automation_enabled(business_id, automation_id, payload.enabled)
        except Exception: raise HTTPException(status_code=503, detail="Automation status could not be updated.")
        if automation is None: raise HTTPException(status_code=404, detail="Automation not found.")
        publish_business_event(business_id, "automation.enabled_changed", "business_automation", str(automation["id"]), {"status":"enabled" if automation["enabled"] else "disabled", "automation_id":str(automation["id"])})
        return {"automation": automation}

    def run(business_id: str, automation_id: str, payload: AutomationRunRequest, dry_run: bool, authorization: str | None):
        authorize(business_id, authorization)
        try: result = run_automation(business_id, automation_id, dry_run=dry_run, idempotency_key=payload.idempotency_key, trigger_id=payload.trigger_id, conversation_id=payload.conversation_id)
        except Exception: raise HTTPException(status_code=503, detail="Automation run could not be recorded.")
        if result.get("error") == "not_found": raise HTTPException(status_code=404, detail="Automation not found.")
        if result.get("error") == "disabled": raise HTTPException(status_code=409, detail="Enable the automation before executing it.")
        if not result.get("duplicate") and result.get("execution"):
            publish_business_event(business_id, "automation.execution_recorded", "automation_execution", str(result["execution"]["id"]), {"status":result["status"], "automation_id":automation_id, "execution_id":str(result["execution"]["id"])})
        return result

    @router.get("/{automation_id}/executions")
    def executions(business_id: str, automation_id: str, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try: return {"executions": list_executions(business_id, automation_id)}
        except Exception: raise HTTPException(status_code=503, detail="Automation history could not be loaded.")
    @router.post("/{automation_id}/dry-run")
    def dry_run(business_id: str, automation_id: str, payload: AutomationRunRequest, authorization: str | None = Header(default=None)):
        return run(business_id, automation_id, payload, True, authorization)

    @router.post("/{automation_id}/execute")
    def execute(business_id: str, automation_id: str, payload: AutomationRunRequest, authorization: str | None = Header(default=None)):
        return run(business_id, automation_id, payload, False, authorization)
    return router
