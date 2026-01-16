# AI Art Cards - User Guide

Welcome to **AI Art Cards**, your personal creative studio for generating consistent, high-quality art for card games, tarot decks, and more.

## 🤖 The AI Art Director Assistant

The heart of this application is the **AI Art Director**, accessible via the Chat panel (top right icon). It is more than just a chatbot; it has full control over the application to help you build your deck.

### Role & Persona
The AI acts as your **Creative Partner**. 
- **Brainstorming**: Ask it for concepts ("Give me 3 ideas for a Fire Element card").
- **Prompt Engineering**: It knows how to write effective prompts for the image generator.
- **Management**: It can create cards, switch projects, and find files for you.

### 💰 Cost Awareness (Important!)
This application uses the **Google Gemini API** for both chat and image generation.
- **Chatting**: Very cheap/free (depending on your quota). Use this freely to brainstorm.
- **Image Generation**: **Costs money per image.**
    - **Best Practice**: Ask the AI to "describe" or "brainstorm" ideas first. Only say "Generate" when you are happy with the concept.
    - **Default Count**: The AI defaults to generating 1 image to save costs. You must explicitly ask for more (e.g., "Generate 4 variations").

---

## 📚 Managing Projects (The "Style Bible")

A **Project** acts as a "Style Bible" for your deck. It ensures every card looks like it belongs to the same set.

### Global Prompt Modifiers
This is the secret sauce for consistency. Instead of typing "oil painting style, 8k" on every single card, you set it **once** in the Project Settings.

1.  Click the **Gear Icon (⚙️)** in the sidebar header.
2.  Look at the **Right Column** (Prompt Modifiers).
3.  **Prefixes**: Text added to the *start* of every prompt.
    - *Use for*: Art style, medium, main subject wrapper (e.g., "A tarot card of").
4.  **Suffixes**: Text added to the *end* of every prompt.
    - *Use for*: Quality boosters, rendering details (e.g., ", trending on ArtStation, 4k, dramatic lighting").

### Per-Card Overrides
Sometimes a specific card needs to break the rules.
- You can **toggle off** specific prefixes/suffixes for an individual card in the Main Editor without deleting them from the project.

---

## 🖥️ Interface Manual

### 1. Sidebar (Left)
- **Project Selector**: Switch between your decks.
- **Search Bar**: Quick filter for cards.
- **Sort Button**: Sort cards by **Creation Date**, **Name**, or **Image Count**.
- **New Card**: Create a blank card.

### 2. Main Editor (Center)
- **Title**: Click the large text at the top to rename the card.
- **API Key**: Top right dropdown. Ensure a key is selected.
- **Prompt Area**: The specific description for *this card only*.
- **Settings**: Override the Aspect Ratio or Resolution for this specific card.

### 3. Gallery (Bottom)
- **Filters**: 
    - ❤️ **Favorites**: Show only your best shots.
    - 🗑️ **Archive**: Show images you've hidden (soft delete).
- **Download**: The down-arrow icon downloads all currently visible images as a ZIP.

### 4. Chat (Right)
- **Thinking Mode 🧠**: Toggles the display of the AI's internal reasoning. Good for debugging or understanding *why* it did something.
- **Image Upload**: Drag and drop images into the chat to use them as references for new generations.

---

## 📂 File Management

### Where is my data?
Everything is stored locally on your computer.
- **Images**: `ai-art-cards/data/output/<project_folder>/<card_folder>/`
- **Database**: `ai-art-cards/data/conversations/` (Chat history) and `projects.json` (Card data).

### How to access files?
- **Quick Links**: 
    - In the Main Editor, click the **Folder Icon** 📂 next to the "Output Subfolder" field.
    - This opens your OS File Explorer directly to the folder containing that card's images.
- **Backups**: To backup your work, simply copy the entire `data` folder to a safe location.
