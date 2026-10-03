import { Composition } from "remotion";
import { VotapeVideo, durationFor } from "./Video";
import { FPS } from "./timeline";

export const Root = () => (
  <>
    <Composition id="YouTube" component={VotapeVideo} durationInFrames={durationFor("youtube")} fps={FPS} width={1920} height={1080} defaultProps={{ format: "youtube" as const }} />
    <Composition id="Reel" component={VotapeVideo} durationInFrames={durationFor("reel")} fps={FPS} width={1080} height={1920} defaultProps={{ format: "reel" as const }} />
  </>
);
