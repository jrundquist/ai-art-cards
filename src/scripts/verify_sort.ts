const images = [
  { filename: "image_2.png", time: new Date("2023-01-02") },
  { filename: "image_1.png", time: new Date("2023-01-01") },
  { filename: "image_10.png", time: new Date("2023-01-03") },
  { filename: "image_100.png", time: new Date("2023-01-04") },
  { filename: "image_3.png", time: new Date("2023-01-05") },
  { filename: "frame_001.png", time: new Date("2023-01-05") },
  { filename: "frame_002.png", time: new Date("2023-01-05") },
  { filename: "frame_010.png", time: new Date("2023-01-05") },
];

console.log(
  "Original:",
  images.map((i) => i.filename),
);

const sorted = [...images].sort((a, b) => {
  // Primary: Filename (Natural) DESCENDING
  const nameDiff = b.filename.localeCompare(a.filename, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (nameDiff !== 0) return nameDiff;
  // Secondary: Time (Newest first)
  return b.time.getTime() - a.time.getTime();
});

console.log(
  "Sorted:",
  sorted.map((i) => i.filename),
);
