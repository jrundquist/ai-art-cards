// Paste this into your browser console to test image navigation manually
(async function testNavigate() {
  const projectId = "test-project";
  const cardId = "0005_card_y1qct77";
  const filename = "0005_card_y1qct77_v001.jpg";

  // Simulate selecting the card first (mocking what chat.js does)
  // We need to access the internal state or controller, which isn't globally exposed easily.
  // But we can verify if the main.js listener works by faking the state check?
  // No, main.js checks import { state }.

  // Easier way: Only fire this event IF you have manually clicked "0005_card_y1qct77" in the UI first.
  // OR, we can try to find the card in the DOM and click it?

  console.log(
    "Please ensure you have selected card 0005_card_y1qct77 in the UI first."
  );

  console.log("Dispatching request-view-image...");
  const event = new CustomEvent("request-view-image", {
    detail: { projectId, cardId, filename },
  });
  document.dispatchEvent(event);
})();
