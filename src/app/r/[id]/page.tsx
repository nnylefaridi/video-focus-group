import { Suspense } from "react";
import { Room } from "@/components/room/Room";

async function RoomFor({ params }: { params: PageProps<"/r/[id]">["params"] }) {
  const { id } = await params;
  return <Room id={id} />;
}

export default function ReviewPage(props: PageProps<"/r/[id]">) {
  return (
    <Suspense>
      <RoomFor params={props.params} />
    </Suspense>
  );
}
