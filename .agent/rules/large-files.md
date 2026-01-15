---
trigger: always_on
---

If you notice a file getting very large (800+ lines) consider how it may be split, and propose making the split. 

Some often-necessary techniques to preform the split may include: 

# Using a custom splitter helper script. 
 - Consider for large files, doing the split programatically. 
 - One potential idea would be to read the file, then read it again leaving markers to denote the start/end of sections that should be moved to a new file.
 - Write a helper script to then look for those markers, and move the content programatically. This will be more efficient on your output tokens, and provide a guarantee that the content was moved completely. 
 - You will likely then need to edit the new files to ensure proper syntax, and add back any 'boilerplate', but this method will reduce overall errors. 

# Directly making the edit. 
 - You may directly edit if the code is already well structured, and looks like it would be a simple change, however LLM agents are prone to making mistakes when replicating large blocks of text. 