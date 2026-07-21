import {Composition} from 'remotion';
import {IrisFilm} from './film/IrisFilm';
import './styles.css';

export const FPS = 30;
export const DURATION = 1786;

export const RemotionRoot = () => (
  <Composition
    id="IrisEmailOperations"
    component={IrisFilm}
    durationInFrames={DURATION}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
