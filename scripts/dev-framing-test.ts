/** Teste manual do enquadramento: npx tsx scripts/dev-framing-test.ts <video> <saida.mp4> */
import { buildFramingTrack, detectFaces } from "../worker/media/framing";
import { probe } from "../worker/media/ffmpeg";
import { renderClip } from "../worker/media/render";

const [input, output] = process.argv.slice(2);
const info = await probe(input);
const segments = [{ s: 0, e: info.duration }];
const samples = await detectFaces(input, 0, info.duration);
const framing = buildFramingTrack(samples, segments);
console.log(JSON.stringify(framing));
await renderClip({ input, source: info, clipStart: 0, segments, format: { aspect: "9:16", layout: "fill" }, framing, assPath: null, output });
