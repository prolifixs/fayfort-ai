select table_name
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
  and table_name in (
    'channel_events',
    'business_connections',
    'business_automations',
    'automation_executions',
    'conversation_handoffs',
    'conversation_handoff_events',
    'business_events',
    'dashboard_event_tickets'
  )
order by table_name;