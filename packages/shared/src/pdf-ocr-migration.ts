export const pdfOcrMigration = `
CREATE TABLE pdf_ocr_jobs (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
 version_id uuid NOT NULL REFERENCES file_versions ON DELETE CASCADE,
 settings jsonb NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','complete','failed','cancelled')),
 error text, cleared_at timestamptz, lease_until timestamptz, output_key uuid, output_bytes bigint NOT NULL DEFAULT 0,
 output_sha256 text, text_bytes bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days');
CREATE INDEX pdf_ocr_pending ON pdf_ocr_jobs(status,created_at);
CREATE INDEX pdf_ocr_owner ON pdf_ocr_jobs(owner_id,version_id,created_at);
CREATE TABLE pdf_ocr_pages (
 job_id uuid NOT NULL REFERENCES pdf_ocr_jobs ON DELETE CASCADE, page integer NOT NULL CHECK(page BETWEEN 1 AND 2000),
 text text NOT NULL, reviewed_text text, reviewed boolean NOT NULL DEFAULT false,
 native boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(job_id,page));
CREATE FUNCTION axiom_cleanup_pdf_ocr() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.output_key IS NOT NULL THEN
 INSERT INTO workspace_jobs(kind,dedupe_key,payload) VALUES('delete-blob','pdf-ocr:'||OLD.id::text,jsonb_build_object('key',OLD.output_key)) ON CONFLICT(dedupe_key) DO NOTHING;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER axiom_cleanup_pdf_ocr AFTER DELETE ON pdf_ocr_jobs FOR EACH ROW EXECUTE FUNCTION axiom_cleanup_pdf_ocr();
`;
