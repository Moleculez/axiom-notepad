import WorkspaceApp from "../../components/workspace/WorkspaceClient";
export default function WorkbenchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <WorkspaceApp />
      {children}
    </>
  );
}
