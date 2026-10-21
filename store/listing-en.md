# Chrome Web Store listing (English)

## Basic information

- Name: Harvest
- Summary: Collect images and videos from web pages, choose the items and their order, and save them to your device.
- Language: English
- Suggested category: Productivity
- Suggested price: Free

## Detailed description

Harvest is an extension for Google Chrome™ that collects images and videos from web pages and lets you save selected items to your device. You can choose how to save images and videos separately. Click the extension icon to open the side panel and work without leaving the page you are viewing.

- Analyze the current page, enter a URL, or drag a URL into the panel. On general web pages, collection includes embedded pages that Chrome allows the extension to read. Collection mode lets you analyze pages in succession by clicking links within a page.
- Filter items by group, choose what to save, and change their order. Filtering the view does not change your selection. When a group is identified as comic content, its images are selected initially.
- Combine still images into a PDF with pages sized to the original images. The recommended image format uses a PDF when the selected still images belong to one series or set, and keeps the original format otherwise. You can optionally add a source page at the end of the PDF.
- Keep animated images in their original format, or save them as animations when choosing image conversion. You can also save just the audio from supported videos. Re-encoding may change audio quality. If a video has no audio or its audio is unsupported, Harvest stops and explains why.
- A single output downloads directly. Multiple images, or a mix of images and video or audio, are bundled into one archive. When only videos are selected, recommended exports, video conversion, and audio extraction save files individually while checking completion in Chrome. Multiple videos saved in their original format are bundled into one archive, except when only Teams/Stream recordings are selected.
- Saving starts after all items are prepared. You can retry only the items that failed to load or convert, or the individual downloads that did not finish. Canceling leaves files that have already been saved on your device.

Page reading, media conversion, and file creation take place in your browser. Executable code is bundled with the extension and is not fetched from external servers. Harvest does not send pages or media to the developer's servers. Collected results and selected formats are held only in the panel's memory and discarded when it closes. Each time the panel opens, both images and videos start with the recommended format. Only the source-page on/off setting is retained in the browser. Pages Chrome cannot read, media that cannot be retrieved with the available access, and items exceeding size, time, or supported-format limits cannot be saved.

When only Teams/Stream recordings are selected, original, recommended and MP4 pass the checked download URL to Chrome and save each original MP4 individually. This direct route does not buffer the whole recording in Harvest’s Blob/ZIP memory and has no Harvest 64 MiB or 120-second limit. Harvest checks completion and Chrome-reported MIME type and file size; it does not inspect the recording body structure as it does for ordinary media Blobs. Recording-to-MP3 conversion and selections mixed with other media retain the normal fetch, structural validation, size, time and ZIP rules. Recording URLs, sizes, received-byte counts and retry state remain in panel memory; retry state is discarded on completion, and all such state is discarded when results change, Clear is used or the panel closes. Saved files and Chrome download records remain under browser and user control.

Google Chrome is a trademark of Google LLC. Use of this trademark is subject to Google Permissions.
