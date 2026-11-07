-- Wall/Door on the DM Map tab used to be a whole-cell terrain value
-- (grid_data[key].terrain === 'wall'/'door'), which consumed the entire
-- 5ft square rather than sitting on a single side of it — confirmed by
-- the DM as a real problem: a wall should sit on the gridline between two
-- cells, leaving both of them ordinary usable floor, matching how the
-- standalone generator's own manual wall/door tool already works.
--
-- wall_edges stores exactly that: a plain jsonb map keyed by edge id
-- ("H:col,row" for the edge on the north side of that cell, "V:col,row"
-- for the west side — see mapEdgeKeyForSide()/renderMapEdgeOverlay() in
-- dm.html), each value a small { type: 'wall'|'door', hidden } object.
-- Same "just add a jsonb column" pattern as background_image/
-- background_transform before it — no need to touch the shape of
-- grid_data itself.
--
-- Existing maps that already have the OLD whole-cell Wall/Door terrain in
-- grid_data keep rendering that way (dm.html still understands it) —
-- nothing here migrates that data automatically. Repaint a wall with the
-- new tool to switch it over to an edge.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table campaign_maps
    add column if not exists wall_edges jsonb not null default '{}'::jsonb;
