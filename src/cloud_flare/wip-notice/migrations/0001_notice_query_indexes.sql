-- Apply once to the D1 database bound to wip-notice.
-- Covers mustRead filtering, idx ordering, and filtered counts.
CREATE INDEX IF NOT EXISTS idx_notices_must_read_idx ON Notices (mustRead, idx);
