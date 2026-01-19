import { Hero } from "@/components/sections/Hero";

import { FeatureWall } from "@/components/sections/FeatureWall";
import { WorkflowDemo } from "@/components/sections/WorkflowDemo";

export default function Home() {
    return (
        <>
            <Hero />
            <WorkflowDemo />
            <FeatureWall />
        </>
    );
}
