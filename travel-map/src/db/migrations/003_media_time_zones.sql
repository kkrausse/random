ALTER TABLE media ADD COLUMN captured_at_local TEXT;
ALTER TABLE media ADD COLUMN captured_time_zone TEXT;
ALTER TABLE media ADD COLUMN captured_time_zone_source TEXT;

ALTER TABLE trips ADD COLUMN time_zone TEXT;
