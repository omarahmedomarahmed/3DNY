import BuildingProfile from '@/components/detail/BuildingProfile';
import CompareTray from '@/components/compare/CompareTray';
import AppHeader from '@/components/shell/AppHeader';

/** Next 15 hands route params in as a promise. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="min-h-screen bg-surface-alt text-body">
      <AppHeader />

      <BuildingProfile buildingId={id} />

      <CompareTray />
    </main>
  );
}
