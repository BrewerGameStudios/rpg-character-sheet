-- Freehand ("ink") walls drawn with the mouse on the DM map builder.
-- Each wall is a list of [x, y] points in grid-cell units, so a map's
-- ink_walls is an array of walls, each an array of points. Defaults to an
-- empty list, so every existing map is unchanged.
alter table campaign_maps add column if not exists ink_walls jsonb default '[]'::jsonb;
