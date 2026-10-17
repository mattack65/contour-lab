# Contour Lab

A local, browser-based tool for designing parametric sculptures, vases and lampshades, with an interactive silhouette editor, strands, smooth interiors and STL export.

Strand thickness can follow the outline perimeter and vary with sine, sine-squared or triangle waves, optionally alternating between neighbours. Fixed centre paths let strands grow without shifting their centres.

An experimental personal project, shared as-is. No support or maintenance commitments.

| Standard light 1 · real print | Standard light 2 · real print |
| --- | --- |
| <a href="samples/README.md#real-prints"><img src="samples/images/print-illuminated-lamp.jpg" width="320" alt="Standard light 1, printed and illuminated"></a> | <a href="samples/README.md#real-prints"><img src="samples/images/print-standard-light-2.jpg" width="320" alt="Standard light 2, printed and illuminated"></a> |

<a href="samples/README.md"><img src="samples/images/standard_light_1.jpg" width="19%" alt="Standard light 1"><img src="samples/images/standard_light_2.jpg" width="19%" alt="Standard light 2"><img src="samples/images/slim_asymmetric_1.jpg" width="19%" alt="Slim asymmetric"><img src="samples/images/funky_2.jpg" width="19%" alt="Funky"><img src="samples/images/hairy.jpg" width="19%" alt="Hairy"></a>

[Sample gallery and recipes](samples/README.md)

## Install and run on your own computer

1. Install and start Docker Desktop: [Windows](https://docs.docker.com/desktop/setup/install/windows-install/) or [Mac](https://docs.docker.com/desktop/setup/install/mac-install/). On Windows use Linux containers / WSL 2; on Mac choose the installer for Intel or Apple Silicon. On Linux, install [Docker Engine with the Compose plugin](https://docs.docker.com/engine/install/).
2. On this GitHub page, choose **Code > Download ZIP**, then extract it.
3. Open PowerShell (Windows) or Terminal (Mac/Linux), and change into the extracted folder containing `compose.yaml`, for example `cd ~/Downloads/contour-lab-main`.
4. Run:

   ```sh
   docker compose up -d --build
   ```

   The first run downloads dependencies and compiles the geometry engine; allow several minutes.
5. Open **http://127.0.0.1:5173** in a modern browser. Edit the shape and strands, press **Build**, then export an STL. **Save** and **Load** keep recipes as JSON files on your computer. In browsers with direct file access, Save updates the selected file; **Save as…** chooses a different file. After a page reload, select the file again on first save. Other browsers use downloads, which may add a numbered suffix. **Clear** starts again with the default sculpture. **Cancel** stops a running build and keeps the previous preview. The current recipe filename appears below Save/Load, with a modified indicator after edits.

Stop: `docker compose down`. Start again: `docker compose up -d`. Run these commands from the same folder. Keep your downloaded recipes and STL files separately when updating the software.

One container runs everything; no separate Node.js or Python installation is needed. It listens only on your own computer. A machine with 16 GB RAM is recommended; large models can need more. Defaults allow 4 CPUs and 8 GB container memory. If needed, create a `.env` file beside `compose.yaml` with `CONTOUR_MEMORY=12g`, `CONTOUR_CPUS=4`, or `CONTOUR_PORT=5174`. Docker Desktop must have enough resources allocated too.

Tested on Windows with Docker Desktop (Linux/amd64). The image is built for your machine's architecture; Mac hardware testing is still pending.

## Samples and licence

The [samples](samples/) folder contains five example recipes. Click **Load** in Contour Lab and choose one of these JSON files, then click **Build**.

Contour Lab is licensed under **GPL-3.0-or-later**; see [LICENSE](LICENSE). Third-party components retain their own licences; see [THIRD_PARTY.md](THIRD_PARTY.md).
