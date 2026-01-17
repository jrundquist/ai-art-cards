import { state } from "../state.js";
import { dom, createToast } from "../ui.js";
import * as api from "../api.js";
import { toggleImageStar, toggleImageFavorite } from "./galleryController.js";

export class BracketController {
  constructor() {
    this.state = {
      isActive: false,
      images: [],
      bracketPairs: [],
      nextRoundImages: [],
      currentPairIndex: 0,
      round: 1,
      totalRounds: 0,
    };
  }

  // Entry point
  async start(images) {
    if (!images || images.length < 2) {
      createToast("Need at least 2 images to compare!", "error");
      return;
    }

    this.state.isActive = true;
    this.state.images = this.shuffleArray([...images]);
    this.state.bracketPairs = [];
    this.state.nextRoundImages = [];
    this.state.round = 1;
    this.state.totalRounds = Math.ceil(Math.log2(this.state.images.length));
    this.state.currentPairIndex = 0;

    this.setupRound(this.state.images);
    this.showModal();
  }

  setupRound(images) {
    this.state.bracketPairs = [];
    this.state.nextRoundImages = [];
    this.state.currentPairIndex = 0;

    for (let i = 0; i < images.length; i += 2) {
      if (i + 1 < images.length) {
        this.state.bracketPairs.push([images[i], images[i + 1]]);
      } else {
        // Odd one out, auto-advance
        this.state.nextRoundImages.push(images[i]);
      }
    }

    this.updateStats();
    this.renderPair();
  }

  renderPair() {
    if (
      !dom.bracketModal ||
      !dom.bracketModal.leftImg ||
      !dom.bracketModal.rightImg
    ) {
      console.error("Bracket modal DOM elements missing");
      return;
    }

    if (this.state.currentPairIndex >= this.state.bracketPairs.length) {
      // Round Complete (should be handled in vote, but safety check)
      return;
    }

    const pair = this.state.bracketPairs[this.state.currentPairIndex];
    dom.bracketModal.leftImg.src = "/" + pair[0];
    dom.bracketModal.rightImg.src = "/" + pair[1];

    // Clear previous selection states if any
    dom.bracketModal.leftContainer.classList.remove("selected");
    dom.bracketModal.rightContainer.classList.remove("selected");
  }

  vote(winnerIndex) {
    const pair = this.state.bracketPairs[this.state.currentPairIndex];
    const winner = pair[winnerIndex];
    const loser = pair[winnerIndex === 0 ? 1 : 0];

    this.state.nextRoundImages.push(winner);
    this.state.currentPairIndex++;

    if (this.state.currentPairIndex < this.state.bracketPairs.length) {
      this.renderPair();
      this.updateStats();
    } else {
      this.endRound(loser);
    }
  }

  endRound(lastLoser) {
    if (this.state.nextRoundImages.length === 1) {
      this.declareWinner(this.state.nextRoundImages[0], lastLoser);
    } else {
      this.state.round++;
      const winners = [...this.state.nextRoundImages];
      this.setupRound(winners);
    }
  }

  async declareWinner(winnerUrl, runnerUpUrl) {
    // 1. Star the winner (if not already starred)
    // toggleImageStar toggles. If current starredImage === filename, it unstars.
    // So we only call it if current starredImage !== filename.
    const winnerFilename = winnerUrl.split("/").pop();
    if (
      state.currentCard &&
      state.currentCard.starredImage !== winnerFilename
    ) {
      await toggleImageStar(winnerUrl);
    }

    // 2. Favorite the runner up (if not already favorite)
    if (runnerUpUrl && state.currentCard) {
      const runnerFilename = runnerUpUrl.split("/").pop();
      const favs = state.currentCard.favoriteImages || [];
      if (!favs.includes(runnerFilename)) {
        await toggleImageFavorite(runnerUpUrl);
      }
    }

    // Close modal
    this.closeModal();

    // Show confusion/celebration?
    createToast("We have a winner! Image starred.", "success");
  }

  updateStats() {
    if (dom.bracketModal.roundIndicator) {
      // e.g., "Round 1/4 - Match 2/8"
      // Wait, total matches in a round depends on the round.
      dom.bracketModal.roundIndicator.textContent = `Round ${this.state.round} / ${this.state.totalRounds} — Match ${this.state.currentPairIndex + 1} / ${this.state.bracketPairs.length}`;
    }
  }

  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  showModal() {
    if (dom.bracketModal.self) {
      dom.bracketModal.self.classList.remove("hidden");
    }
  }

  closeModal() {
    if (dom.bracketModal.self) {
      dom.bracketModal.self.classList.add("hidden");
    }
    this.state.isActive = false;
    this.reset();
  }

  reset() {
    this.state.images = [];
    this.state.bracketPairs = [];
    this.state.nextRoundImages = [];
    this.state.currentPairIndex = 0;
    this.state.round = 1;
  }
}

export const bracketController = new BracketController();
