-- Series saved with their place spelled out ("The Chronicles of Narnia, Book Three") were
-- one series per book, so they never stacked. parseSeries now reads the word as a number;
-- this does the same to the names already saved: the name loses ", Book Three", and the book
-- gets 3 as its number unless it already has one. Only a word from the list after "Book",
-- "Volume" and the like is touched, the same rule as NUMBER_WORDS in src/lib/series.ts.
WITH number_words (word, n) AS (
  VALUES
    ('one', 1), ('two', 2), ('three', 3), ('four', 4), ('five', 5), ('six', 6), ('seven', 7),
    ('eight', 8), ('nine', 9), ('ten', 10), ('eleven', 11), ('twelve', 12), ('thirteen', 13),
    ('fourteen', 14), ('fifteen', 15), ('sixteen', 16), ('seventeen', 17), ('eighteen', 18),
    ('nineteen', 19), ('twenty', 20),
    ('first', 1), ('second', 2), ('third', 3), ('fourth', 4), ('fifth', 5), ('sixth', 6),
    ('seventh', 7), ('eighth', 8), ('ninth', 9), ('tenth', 10), ('eleventh', 11), ('twelfth', 12),
    ('thirteenth', 13), ('fourteenth', 14), ('fifteenth', 15), ('sixteenth', 16),
    ('seventeenth', 17), ('eighteenth', 18), ('nineteenth', 19), ('twentieth', 20)
),
spelled AS (
  SELECT id, regexp_match(series, '^(.*[^\s,;:(-])[\s,;:(-]+(?:bk|book|no|number|v|vol|volume|pt|part)\.?\s+([a-z]+)\)?\.?\s*$', 'i') AS parts
  FROM books
  WHERE series IS NOT NULL
)
UPDATE books
SET series = spelled.parts[1], series_number = coalesce(books.series_number, number_words.n)
FROM spelled
JOIN number_words ON number_words.word = lower(spelled.parts[2])
WHERE books.id = spelled.id;
