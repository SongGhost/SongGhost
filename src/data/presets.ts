export type PresetTrack = {
  id: string;
  title: string;
  artist: string;
  albumArt: string;
  youtubeId: string;
  frequency: number;
};

export const PRESET_TRACKS: PresetTrack[] = [
  {
    id: "1",
    title: "Bohemian Rhapsody",
    artist: "Queen",
    albumArt: "https://i.ytimg.com/vi/fJ9rUzIMcZQ/hqdefault.jpg",
    youtubeId: "fJ9rUzIMcZQ",
    frequency: 88.5,
  },
  {
    id: "2",
    title: "Hotel California",
    artist: "Eagles",
    albumArt: "https://i.ytimg.com/vi/BciS5krYL80/hqdefault.jpg",
    youtubeId: "BciS5krYL80",
    frequency: 92.3,
  },
  {
    id: "3",
    title: "Sweet Child O' Mine",
    artist: "Guns N' Roses",
    albumArt: "https://i.ytimg.com/vi/1w7OgIMMRc4/hqdefault.jpg",
    youtubeId: "1w7OgIMMRc4",
    frequency: 96.7,
  },
  {
    id: "4",
    title: "Don't Stop Believin'",
    artist: "Journey",
    albumArt: "https://i.ytimg.com/vi/1k8craCGpgs/hqdefault.jpg",
    youtubeId: "1k8craCGpgs",
    frequency: 101.1,
  },
  {
    id: "5",
    title: "Stairway to Heaven",
    artist: "Led Zeppelin",
    albumArt: "https://i.ytimg.com/vi/xbhCPt6PZIU/hqdefault.jpg",
    youtubeId: "xbhCPt6PZIU",
    frequency: 104.5,
  },
  {
    id: "6",
    title: "Dream On",
    artist: "Aerosmith",
    albumArt: "https://i.ytimg.com/vi/89dGC8de0CA/hqdefault.jpg",
    youtubeId: "89dGC8de0CA",
    frequency: 107.9,
  },
];
