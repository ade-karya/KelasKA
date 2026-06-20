-- stages (mirror dari Dexie)
CREATE TABLE IF NOT EXISTS synced_stages (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  description TEXT,
  language_directive TEXT,
  style TEXT,
  current_scene_id TEXT,
  agent_ids JSONB DEFAULT '[]',
  video_manifest JSONB,
  interactive_mode BOOLEAN DEFAULT false,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT -- soft delete for sync
);

-- scenes (mirror dari Dexie)
CREATE TABLE IF NOT EXISTS synced_scenes (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  stage_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  content JSONB NOT NULL,
  actions JSONB,
  whiteboard JSONB,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT
);

-- chat_sessions (mirror dari Dexie)
CREATE TABLE IF NOT EXISTS synced_chat_sessions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  stage_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  messages JSONB NOT NULL,
  config JSONB NOT NULL,
  tool_calls JSONB NOT NULL,
  pending_tool_calls JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  scene_id TEXT,
  last_action_index INTEGER,
  deleted_at BIGINT
);

-- generated_agents (mirror dari Dexie)
CREATE TABLE IF NOT EXISTS synced_generated_agents (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  stage_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  persona TEXT NOT NULL,
  avatar TEXT NOT NULL,
  color TEXT NOT NULL,
  priority INTEGER NOT NULL,
  voice_design JSONB,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT
);

-- stage_outlines (mirror dari Dexie)
CREATE TABLE IF NOT EXISTS synced_stage_outlines (
  stage_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  outlines JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT
);

-- playback_state (mirror dari Dexie)
CREATE TABLE IF NOT EXISTS synced_playback_state (
  stage_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  scene_index INTEGER NOT NULL,
  action_index INTEGER NOT NULL,
  consumed_discussions JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT
);

-- voice_profiles (mirror dari Dexie)
CREATE TABLE IF NOT EXISTS synced_voice_profiles (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  provider_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  voice_prompt TEXT,
  prompt_text TEXT,
  reference_audio BYTEA,
  reference_audio_name TEXT,
  reference_audio_mime_type TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT
);

-- Row Level Security for all tables
ALTER TABLE synced_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own stages" ON synced_stages FOR ALL USING (auth.uid() = user_id);

ALTER TABLE synced_scenes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own scenes" ON synced_scenes FOR ALL USING (auth.uid() = user_id);

ALTER TABLE synced_chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own chat sessions" ON synced_chat_sessions FOR ALL USING (auth.uid() = user_id);

ALTER TABLE synced_generated_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own generated agents" ON synced_generated_agents FOR ALL USING (auth.uid() = user_id);

ALTER TABLE synced_stage_outlines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own stage outlines" ON synced_stage_outlines FOR ALL USING (auth.uid() = user_id);

ALTER TABLE synced_playback_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own playback states" ON synced_playback_state FOR ALL USING (auth.uid() = user_id);

ALTER TABLE synced_voice_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own voice profiles" ON synced_voice_profiles FOR ALL USING (auth.uid() = user_id);

-- Indexes for sync queries
CREATE INDEX idx_synced_stages_updated ON synced_stages(user_id, updated_at);
CREATE INDEX idx_synced_scenes_updated ON synced_scenes(user_id, updated_at);
CREATE INDEX idx_synced_chat_sessions_updated ON synced_chat_sessions(user_id, updated_at);
CREATE INDEX idx_synced_generated_agents_updated ON synced_generated_agents(user_id, updated_at);
CREATE INDEX idx_synced_stage_outlines_updated ON synced_stage_outlines(user_id, updated_at);
CREATE INDEX idx_synced_playback_state_updated ON synced_playback_state(user_id, updated_at);
CREATE INDEX idx_synced_voice_profiles_updated ON synced_voice_profiles(user_id, updated_at);
