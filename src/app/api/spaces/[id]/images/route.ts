import { NextResponse } from 'next/server';
import { addSpaceImage, deleteRow, getSpaceImages } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  if (message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await getSpaceImages(id));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { blob_url?: string; caption?: string | null };
    if (!body.blob_url) {
      return NextResponse.json({ error: 'blob_url is required.' }, { status: 400 });
    }
    return NextResponse.json(await addSpaceImage(id, body.blob_url, body.caption ?? null));
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const imageId = new URL(req.url).searchParams.get('imageId');
    if (!imageId) {
      return NextResponse.json({ error: 'imageId query parameter is required.' }, { status: 400 });
    }
    await deleteRow('space_images', imageId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
