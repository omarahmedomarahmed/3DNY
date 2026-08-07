import Link from 'next/link';
import BuildingProfile from '@/components/detail/BuildingProfile';
import CompareTray from '@/components/compare/CompareTray';

/** Next 15 hands route params in as a promise. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="min-h-screen bg-ink text-white">
      <nav className="sticky top-0 z-30 border-b border-edge bg-ink/95 px-4 py-2 backdrop-blur">
        <Link href="/" className="text-xs text-accent hover:underline">
          ← Back to the map
        </Link>
      </nav>

      <BuildingProfile buildingId={id} />

      <CompareTray />
    </main>
  );
}
