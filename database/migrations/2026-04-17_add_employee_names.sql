-- Add employee first/last name columns (run once on existing DBs)
ALTER TABLE employee
  ADD COLUMN fname VARCHAR(25) NULL,
  ADD COLUMN lname VARCHAR(25) NULL;

