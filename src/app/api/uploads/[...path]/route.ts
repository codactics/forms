import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const UPLOADS_ROOT = path.join(process.cwd(), "data", "uploads");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const [formId, submissionId, ...rest] = segments;
  const fileName = rest.join("/");
  if (!formId || !submissionId || !fileName) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const form = await prisma.form.findUnique({ where: { id: formId } });
  if (
    !form ||
    form.adminId !== session.user.id ||
    form.storageProvider !== "local"
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Resolve and confirm the final path never escapes the uploads root —
  // formId/submissionId/fileName are all attacker-controlled URL segments.
  const resolved = path.resolve(UPLOADS_ROOT, formId, submissionId, fileName);
  if (!resolved.startsWith(path.resolve(UPLOADS_ROOT) + path.sep)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(resolved);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
