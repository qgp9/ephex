ALTER TABLE images ADD COLUMN encryption_mode TEXT DEFAULT 'plain';
ALTER TABLE images ADD COLUMN encrypted_key TEXT;
ALTER TABLE images ADD COLUMN key_algorithm TEXT;

UPDATE images
SET encryption_mode = CASE
    WHEN is_encrypted = 1 THEN 'symmetric'
    ELSE 'plain'
END
WHERE encryption_mode IS NULL;
