#!/bin/sh
set -eu

DB=${1:?usage: migrate-v2-history.sh /path/to/opencode.db}

command -v sqlite3 >/dev/null 2>&1 || {
  printf 'sqlite3 is required to migrate OpenCode V2 history.\n' >&2
  exit 1
}

# The beta event table has a required created column that stable OpenCode does
# not populate. Keep existing events while bringing the table shape in line.
if [ "$(sqlite3 "$DB" "SELECT count(*) FROM pragma_table_info('event') WHERE name = 'created';")" -gt 0 ]; then
  sqlite3 "$DB" "ALTER TABLE event DROP COLUMN created;"
  printf 'Removed the beta-only event.created column.\n'
fi

session_messages=$(sqlite3 "$DB" "SELECT count(*) FROM session_message;")
classic_messages=$(sqlite3 "$DB" "SELECT count(*) FROM message;")
if [ "$session_messages" -eq 0 ] || [ "$classic_messages" -gt 0 ]; then
  exit 0
fi

sqlite3 "$DB" <<'SQL'
BEGIN IMMEDIATE;

UPDATE session
SET title = 'Untitled reading chat'
WHERE title IS NULL;

INSERT INTO message (id, session_id, time_created, time_updated, data)
SELECT
  sm.id,
  sm.session_id,
  sm.time_created,
  sm.time_updated,
  CASE sm.type
    WHEN 'user' THEN json_object(
      'id', sm.id,
      'sessionID', sm.session_id,
      'role', 'user',
      'time', json_object('created', sm.time_created),
      'agent', coalesce(
        (SELECT json_extract(next.data, '$.agent')
         FROM session_message next
         WHERE next.session_id = sm.session_id
           AND next.seq > sm.seq
           AND next.type = 'assistant'
         ORDER BY next.seq LIMIT 1),
        'build'
      ),
      'model', json_object(
        'providerID', coalesce(
          (SELECT json_extract(next.data, '$.model.providerID')
           FROM session_message next
           WHERE next.session_id = sm.session_id
             AND next.seq > sm.seq
             AND next.type = 'assistant'
           ORDER BY next.seq LIMIT 1),
          'opencode'
        ),
        'modelID', coalesce(
          (SELECT json_extract(next.data, '$.model.id')
           FROM session_message next
           WHERE next.session_id = sm.session_id
             AND next.seq > sm.seq
             AND next.type = 'assistant'
           ORDER BY next.seq LIMIT 1),
          'unknown'
        )
      )
    )
    ELSE json_object(
      'id', sm.id,
      'sessionID', sm.session_id,
      'role', 'assistant',
      'time', json_patch(
        json_object('created', sm.time_created),
        CASE WHEN json_extract(sm.data, '$.time.completed') IS NULL
          THEN '{}'
          ELSE json_object('completed', json_extract(sm.data, '$.time.completed'))
        END
      ),
      'parentID', coalesce(
        (SELECT previous.id
         FROM session_message previous
         WHERE previous.session_id = sm.session_id
           AND previous.seq < sm.seq
           AND previous.type = 'user'
         ORDER BY previous.seq DESC LIMIT 1),
        sm.id
      ),
      'modelID', coalesce(json_extract(sm.data, '$.model.id'), 'unknown'),
      'providerID', coalesce(json_extract(sm.data, '$.model.providerID'), 'opencode'),
      'agent', coalesce(json_extract(sm.data, '$.agent'), 'build'),
      'mode', coalesce(json_extract(sm.data, '$.agent'), 'build'),
      'path', json_object('cwd', s.directory, 'root', s.directory),
      'cost', coalesce(json_extract(sm.data, '$.cost'), 0),
      'tokens', json_object(
        'input', coalesce(json_extract(sm.data, '$.tokens.input'), 0),
        'output', coalesce(json_extract(sm.data, '$.tokens.output'), 0),
        'reasoning', coalesce(json_extract(sm.data, '$.tokens.reasoning'), 0),
        'cache', json_object(
          'read', coalesce(json_extract(sm.data, '$.tokens.cache.read'), 0),
          'write', coalesce(json_extract(sm.data, '$.tokens.cache.write'), 0)
        )
      )
    )
  END
FROM session_message sm
JOIN session s ON s.id = sm.session_id;

INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
SELECT
  'prt_migrated_' || sm.id,
  sm.id,
  sm.session_id,
  sm.time_created,
  sm.time_updated,
  json_object(
    'id', 'prt_migrated_' || sm.id,
    'sessionID', sm.session_id,
    'messageID', sm.id,
    'type', 'text',
    'text', json_extract(sm.data, '$.text')
  )
FROM session_message sm
WHERE sm.type = 'user';

INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
SELECT
  'prt_migrated_' || sm.id || '_' || content.key,
  sm.id,
  sm.session_id,
  sm.time_created,
  sm.time_updated,
  json_object(
    'id', 'prt_migrated_' || sm.id || '_' || content.key,
    'sessionID', sm.session_id,
    'messageID', sm.id,
    'type', 'text',
    'text', json_extract(content.value, '$.text')
  )
FROM session_message sm, json_each(sm.data, '$.content') content
WHERE sm.type = 'assistant'
  AND json_extract(content.value, '$.type') = 'text';

COMMIT;
SQL

printf 'Migrated %s OpenCode V2 message records into stable history tables.\n' "$session_messages"
