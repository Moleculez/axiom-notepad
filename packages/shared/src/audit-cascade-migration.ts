/** Resolve cascade-deletion metadata from retained scopes, not deleted parents. */
export const auditCascadeMigration = `
DO $$ DECLARE definition text; marker text := 'IF gid IS NULL THEN SELECT group_id INTO gid FROM audit_scopes WHERE space_id=sid; END IF;'; BEGIN
 SELECT pg_get_functiondef('axiom_audit_capture()'::regprocedure) INTO definition;
 IF position(marker IN definition)=0 THEN
   RAISE EXCEPTION 'Unexpected audit function; refusing an ambiguous migration';
 END IF;
 definition := replace(definition,marker,$patch$
 IF sid IS NULL AND TG_OP='DELETE' THEN
   IF TG_TABLE_NAME IN ('projects','project_members') THEN
     SELECT space_id,group_id INTO sid,gid FROM audit_scopes
       WHERE project_id=CASE WHEN TG_TABLE_NAME='projects' THEN (v->>'id')::uuid ELSE (v->>'project_id')::uuid END;
   ELSIF TG_TABLE_NAME IN ('groups','members','invitations','tool_providers') THEN
     SELECT space_id INTO sid FROM audit_scopes WHERE group_id=gid AND kind='team';
   ELSE
     SELECT e.space_id,coalesce(label,e.entity_name) INTO sid,label FROM audit_events e
       WHERE e.entity_id=eid AND e.space_id IS NOT NULL ORDER BY e.id DESC LIMIT 1;
   END IF;
 END IF;
 IF gid IS NULL THEN SELECT group_id INTO gid FROM audit_scopes WHERE space_id=sid; END IF;
 $patch$);
 EXECUTE definition;
END $$;
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION axiom_audit_immutable();
`;
