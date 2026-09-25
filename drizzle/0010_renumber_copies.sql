-- Close the gaps deleted copies left in each title's numbering, so copies read 1, 2, 3… in
-- their existing order. From now on deleting a copy renumbers the rest (renumberCopies).
-- Only titles with a gap are touched. The unique (book_id, copy_number) key is checked row
-- by row, so the affected copies first move clear of every existing number, then settle.
WITH gapped AS (
  SELECT book_id FROM copies GROUP BY book_id HAVING max(copy_number) <> count(*)
)
UPDATE copies SET copy_number = copy_number + 1000000
WHERE book_id IN (SELECT book_id FROM gapped);
--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY book_id ORDER BY copy_number) AS n
  FROM copies
  WHERE copy_number > 1000000
)
UPDATE copies SET copy_number = ranked.n
FROM ranked
WHERE copies.id = ranked.id;
