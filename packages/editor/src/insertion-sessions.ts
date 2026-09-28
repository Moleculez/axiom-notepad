import * as Y from "yjs";

/** Author-local asynchronous intentions. Never stores an alternative document. */
export class InsertionSessions {
  private sessions = new Map<
    string,
    {
      doc: Y.Doc;
      start: Y.RelativePosition;
      end: Y.RelativePosition;
      text: string;
      at: number;
      valid: boolean;
    }
  >();
  private observers = new Map<Y.Doc, (event: Y.YTextEvent) => void>();
  create(doc: Y.Doc, from: number, to: number) {
    const text = doc.getText("markdown"),
      id = crypto.randomUUID();
    if (from < 0 || to < from || to > text.length)
      throw new Error("Invalid insertion range.");
    this.sessions.set(id, {
      doc,
      start: Y.createRelativePositionFromTypeIndex(text, from, 0),
      end: Y.createRelativePositionFromTypeIndex(
        text,
        to,
        from === to ? 0 : -1,
      ),
      text: text.toString().slice(from, to),
      at: from,
      valid: true,
    });
    if (!this.observers.has(doc)) {
      const observe = (event: Y.YTextEvent) => {
        for (const session of this.sessions.values()) {
          if (session.doc !== doc || !session.valid) continue;
          let offset = 0;
          for (const delta of event.delta) {
            if (delta.retain) offset += delta.retain;
            if (delta.delete) {
              if (
                session.text.length === 0 &&
                offset <= session.at &&
                offset + delta.delete >= session.at
              )
                session.valid = false;
              offset += delta.delete;
            }
          }
          session.at =
            Y.createAbsolutePositionFromRelativePosition(session.start, doc)
              ?.index ?? session.at;
        }
      };
      this.observers.set(doc, observe);
      text.observe(observe);
    }
    return id;
  }
  resolve(id: string, doc: Y.Doc) {
    const pending = this.sessions.get(id);
    if (!pending || !pending.valid || pending.doc !== doc) return null;
    const start = Y.createAbsolutePositionFromRelativePosition(
        pending.start,
        doc,
      ),
      end = Y.createAbsolutePositionFromRelativePosition(pending.end, doc);
    if (
      !start ||
      !end ||
      start.type !== doc.getText("markdown") ||
      end.type !== start.type ||
      start.index > end.index ||
      doc.getText("markdown").toString().slice(start.index, end.index) !==
        pending.text
    )
      return null;
    return { from: start.index, to: end.index };
  }
  cancel(id: string) {
    const doc = this.sessions.get(id)?.doc;
    this.sessions.delete(id);
    if (
      doc &&
      ![...this.sessions.values()].some((session) => session.doc === doc)
    ) {
      const observer = this.observers.get(doc);
      if (observer) doc.getText("markdown").unobserve(observer);
      this.observers.delete(doc);
    }
  }
  clear() {
    for (const [doc, observer] of this.observers)
      doc.getText("markdown").unobserve(observer);
    this.observers.clear();
    this.sessions.clear();
  }
}
