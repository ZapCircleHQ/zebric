BEGIN TRANSACTION;
INSERT INTO developer (id, full_name, email, team, role, mentor_id, buddy_id, manager_id, status, start_date)
VALUES
  ('dev_001', 'Alex Rivera', 'alex@startup.com', 'Platform', 'Senior Engineer', 'mgr_001', 'buddy_001', 'mgr_001', 'day_one', '2024-03-15'),
  ('dev_002', 'Bryn Patel', 'bryn@startup.com', 'Infrastructure', 'Staff Engineer', 'mgr_002', 'buddy_002', 'mgr_002', 'preboarding', '2024-04-01');

INSERT INTO onboarding_task (id, developer_id, title, type, assignee_id, status, due_date)
VALUES
  ('task_001', 'dev_001', 'Ship laptop', 'equipment', 'it-team', 'done', '2024-03-10'),
  ('task_002', 'dev_001', 'Enable GitHub access', 'security', 'devops', 'in_progress', '2024-03-16'),
  ('task_003', 'dev_001', 'Schedule mentor sync', 'training', 'mgr_001', 'todo', '2024-03-18'),
  ('task_004', 'dev_002', 'Collect onboarding paperwork', 'paperwork', 'people-ops', 'todo', '2024-03-25'),
  ('task_005', 'dev_002', 'Provision Slack + Notion', 'security', 'devops', 'pending', '2024-03-27');

INSERT INTO access_item (id, developer_id, system, scope, status, owner_id)
VALUES
  ('access_001', 'dev_001', 'GitHub', 'org:startup/platform', 'provisioned', 'devops'),
  ('access_002', 'dev_001', 'Vercel', 'team:platform', 'pending', 'devops'),
  ('access_003', 'dev_002', 'Datadog', 'org:startup', 'requested', 'devops');

INSERT INTO ramp_milestone (id, developer_id, title, target_date, status)
VALUES
  ('milestone_001', 'dev_001', 'First PR merged', '2024-03-22', 'pending'),
  ('milestone_002', 'dev_001', 'Shadow oncall rotation', '2024-04-05', 'pending'),
  ('milestone_003', 'dev_002', 'Intro project proposal', '2024-04-12', 'pending');
COMMIT;
