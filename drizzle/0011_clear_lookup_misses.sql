-- Forget every cached "not found". Until now one could be cached while a catalogue was
-- refusing requests (Google Books with its daily quota spent), and it then hid a real book
-- for a day. Only the shared lookup cache is touched; the next lookup asks the catalogues.
DELETE FROM isbn_lookup_cache WHERE payload IS NULL;
