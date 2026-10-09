"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, TextInput, SearchField } from "../ui/controls";
import { useEffect, useState } from "react";
import { Check, Copy, LockKeyhole, Users } from "lucide-react";
import type { Space } from "@axiom/shared/workspace";
import { fileRouteId } from "@axiom/shared/file-routes";
import Dialog from "../Dialog";
import Avatar from "./Avatar";
import { Badge, ErrorNotice, Loading, useData, useWorkspace } from "./ui";
type Access = {
  resource: { id: string; name: string };
  path: string;
  space: Space;
  members: { id: string; name: string; image?: string | null; role: string }[];
  nextPage: number | null;
};
export default function ResourceSharing({
  resourceId,
}: {
  resourceId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        className="button secondary ws-share-button"
        onClick={() => setOpen(true)}
      >
        <Users size={15} />
        <I18nText id="Share" />
      </Button>
      {open && (
        <SharingDialog resourceId={resourceId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
function SharingDialog({
  resourceId,
  onClose,
}: {
  resourceId: string;
  onClose: () => void;
}) {
  useInterfaceLocale();
  const { session, revision, navigate } = useWorkspace();
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [page, setPage] = useState(0),
    [status, setStatus] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const access = useData<Access>(
    `resources/${resourceId}/access?q=${encodeURIComponent(query)}&page=${page}`,
    revision,
  );
  const value = access.data,
    personal = value?.space.kind === "personal";
  const link = value
    ? new URL("/workbench" + value.path, location.origin)
    : null;
  if (link && fileRouteId(location.pathname) === resourceId) {
    const current = new URL(location.href);
    if (
      current.searchParams.has("version") &&
      !current.searchParams.has("file")
    )
      link.searchParams.set("version", current.searchParams.get("version")!);
  }
  return (
    <Dialog
      title={uiText("Sharing & collaboration")}
      subtitle={value?.resource.name ?? "Checking file access…"}
      onClose={onClose}
    >
      <ErrorNotice message={access.error} retry={access.reload} />
      {!value && access.loading ? (
        <Loading label={uiText("Checking access…")} />
      ) : (
        value && (
          <>
            <section
              className="sharing-access-summary"
              aria-label={uiText("File access")}
            >
              <span className="sharing-access-icon">
                <LockKeyhole size={20} />
              </span>
              <div>
                <strong>
                  {personal ? uiText("Only you") : value.space.name}
                </strong>
                <p>
                  {personal
                    ? uiText("Private to your account.")
                    : uiText("Access is inherited from this workspace.")}
                </p>
              </div>
              <Badge>
                {personal ? uiText("Private") : uiText("Restricted")}
              </Badge>
            </section>
            {!personal && (
              <section className="sharing-people">
                <h3>
                  <I18nText id="People with access" />
                </h3>
                <SearchField
                  wrapperClassName="sharing-search"
                  type="search"
                  aria-label={uiText("Find a collaborator")}
                  placeholder={uiText("Find a collaborator…")}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <ul
                  className="sharing-member-list"
                  aria-label={uiText("People with access")}
                  aria-busy={access.loading}
                >
                  {value.members.map((member) => (
                    <li key={member.id}>
                      <Avatar person={member} className="sharing-avatar" />
                      <span className="sharing-member-name">
                        {member.name}
                        {member.id === session.user.id && (
                          <small>
                            <I18nText id="You" />
                          </small>
                        )}
                      </span>
                      <Badge>{member.role}</Badge>
                    </li>
                  ))}
                </ul>
                {!value.members.length && (
                  <p className="muted">
                    <I18nText id="No matching collaborators." />
                  </p>
                )}
                {(page > 0 || value.nextPage !== null) && (
                  <div className="sharing-pagination">
                    <Button
                      type="button"
                      className="button ghost small"
                      disabled={page === 0 || access.loading}
                      onClick={() => setPage(page - 1)}
                    >
                      <I18nText id="Previous" />
                    </Button>
                    <span>
                      <I18nText id="Page" /> {page + 1}
                    </span>
                    <Button
                      type="button"
                      className="button ghost small"
                      disabled={value.nextPage === null || access.loading}
                      onClick={() => setPage(value.nextPage!)}
                    >
                      <I18nText id="Next" />
                    </Button>
                  </div>
                )}
              </section>
            )}
            <section className="sharing-link-section">
              <label htmlFor={`share-link-${resourceId}`}>
                <I18nText id="Link to this file" />
              </label>
              <div className="sharing-link-row">
                <TextInput
                  id={`share-link-${resourceId}`}
                  readOnly
                  value={link?.href ?? ""}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  type="button"
                  className="button secondary"
                  aria-label={uiText("Copy file link")}
                  onClick={() => {
                    if (link)
                      void navigator.clipboard.writeText(link.href).then(
                        () => setStatus("Link copied."),
                        () =>
                          setStatus(
                            "Clipboard unavailable. Select and copy the link above.",
                          ),
                      );
                  }}
                >
                  {status === "Link copied." ? (
                    <Check size={16} />
                  ) : (
                    <Copy size={16} />
                  )}
                  <I18nText id="Copy" />
                </Button>
              </div>
              <p>
                <I18nText id="Copying a link never grants access. Collaborators must sign in." />
              </p>
              {status && <p role="status">{status}</p>}
            </section>
          </>
        )
      )}
      <div className="dialog-footer">
        {value?.space.can_manage && !personal && (
          <Button
            type="button"
            className="button secondary"
            onClick={() => {
              onClose();
              navigate(`/workspaces/${value.space.id}/people`);
            }}
          >
            <I18nText id="Manage access" />
          </Button>
        )}
        <span className="dialog-spacer" />
        <Button type="button" className="button primary" onClick={onClose}>
          <I18nText id="Done" />
        </Button>
      </div>
    </Dialog>
  );
}
