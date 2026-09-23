/**
 * JSON-UI Maker Mobile Patch v11 CLEAN
 *
 * Rebuilt from scratch to avoid the cumulative observers/preloads that caused
 * the editor to freeze on mobile.
 *
 * Included:
 * - Touch drag/resize + native two-finger pinch zoom
 * - EDITAR/NAVEGAR mobile toggle
 * - Correct selected-parent locking when adding images
 * - Generic Android file picker + optional Gallery picker
 * - Free image resize / aspect lock / fill parent
 * - Texture replacement preserves exact geometry and current box ratio
 * - Hybrid JSON importer:
 *      native editor JSON -> original importer
 *      ordinary Bedrock JSON UI -> lazy best-effort importer
 * - Lazy smart texture resolver, no bulk preload at page startup
 * - Missing textures get fallback under their ORIGINAL path
 */
(() => {
    "use strict";

    if (window.__RAG_JSON_UI_PATCH_V11__) return;
    window.__RAG_JSON_UI_PATCH_V11__ = true;
    window.__RAG_TOUCH_PATCH_BUILD__ = "v19-editable-headers";

    const BUILD = "v19-editable-headers";
    const DRAG_THRESHOLD = 6;
    const COMPAT_MOUSE_BLOCK_MS = 850;

    const hasTouch =
        navigator.maxTouchPoints > 0 ||
        window.matchMedia?.("(pointer: coarse)").matches;

    const syntheticMouseEvents = new WeakSet();
    const activeTouches = new Set();

    let mainWindow = null;
    let editMode = true;
    let nativePinch = false;
    let activePointerId = null;
    let downTarget = null;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    let dragStarted = false;
    let suppressCompatMouseUntil = 0;

    let imageParentLock = null;
    let modulesPromise = null;
    let propertyObserver = null;

    const universalState = {
        parsed: null,
        namespace: "imported_ui",
        roots: [],
        root: "",
        missingPaths: new Set(),
        rawById: new Map(),
    };

    window.__RAG_UNIVERSAL_JSON_STATE__ = universalState;

    const PRESET_CATALOG = new Map([
        ["red_default_button", ["red_ore-ui_style", true]],
        ["red_default_secondary_button", ["red_ore-ui_style", true]],
        ["red_hover_button", ["red_ore-ui_style", true]],
        ["red_hover_secondary_button", ["red_ore-ui_style", true]],
        ["red_pressed_button", ["red_ore-ui_style", true]],
        ["red_default_background", ["red_ore-ui_style", true]],

        ["eternal_default_button", ["eternal_ore-ui_style", true]],
        ["eternal_hover_button", ["eternal_ore-ui_style", true]],
        ["eternal_default_background", ["eternal_ore-ui_style", true]],
        ["eternal_default_title_background", ["eternal_ore-ui_style", true]],

        ["pink_default_button", ["pink_ore-ui_style", true]],
        ["pink_default_secondary_button", ["pink_ore-ui_style", true]],
        ["pink_hover_button", ["pink_ore-ui_style", true]],
        ["pink_hover_secondary_button", ["pink_ore-ui_style", true]],
        ["pink_pressed_button", ["pink_ore-ui_style", true]],
        ["pink_default_background", ["pink_ore-ui_style", true]],

        ["turquoise_default_button", ["turquoise_ore-ui_style", true]],
        ["turquoise_hover_button", ["turquoise_ore-ui_style", true]],
        ["turquoise_default_background", ["turquoise_ore-ui_style", true]],
        ["turquoise_default_title_background", ["turquoise_ore-ui_style", true]],

        ["background_form", ["other_ore-ui_style", true]],
        ["dropdown_background2", ["other_ore-ui_style", true]],
        ["green_default", ["other_ore-ui_style", true]],
        ["green_hover", ["other_ore-ui_style", true]],
        ["green_pressed", ["other_ore-ui_style", true]],
        ["arrow_down", ["other_ore-ui_style", false]],
        ["arrow_up", ["other_ore-ui_style", false]],
        ["back_full_arrow", ["other_ore-ui_style", false]],
        ["checked", ["other_ore-ui_style", true]],
        ["default", ["other_ore-ui_style", true]],
        ["dropdown_background", ["other_ore-ui_style", true]],
        ["dropdowndefault", ["other_ore-ui_style", true, "dropDownDefault"]],
        ["dropdownhoverbg", ["other_ore-ui_style", true, "dropDownHoverBG"]],
        ["dropdownselectbg", ["other_ore-ui_style", true, "dropDownSelectBG"]],
        ["exit", ["other_ore-ui_style", false]],
        ["fullred_default", ["other_ore-ui_style", true]],
        ["fullred_hover", ["other_ore-ui_style", true]],
        ["hover", ["other_ore-ui_style", true]],
        ["indent", ["other_ore-ui_style", true]],
        ["indent_hover", ["other_ore-ui_style", true]],
        ["off", ["other_ore-ui_style", false]],
        ["off_hover", ["other_ore-ui_style", false]],
        ["on", ["other_ore-ui_style", false]],
        ["on_hover", ["other_ore-ui_style", false]],
        ["purple_checked", ["other_ore-ui_style", true]],
        ["purple_checked_hover", ["other_ore-ui_style", true]],
        ["purple_checked_toggled", ["other_ore-ui_style", true]],
        ["purple_unchecked", ["other_ore-ui_style", true]],
        ["purple_unchecked_hover", ["other_ore-ui_style", true]],
        ["radio_on", ["other_ore-ui_style", false]],
        ["red_default", ["other_ore-ui_style", true]],
        ["red_hover", ["other_ore-ui_style", true]],
        ["scrollhandle", ["other_ore-ui_style", true, "ScrollHandle"]],
        ["unchecked", ["other_ore-ui_style", true]],
        ["unchecked_hover", ["other_ore-ui_style", true]],
        ["white_checked", ["other_ore-ui_style", true]],
        ["white_checked_hover", ["other_ore-ui_style", true]],
        ["white_unchecked", ["other_ore-ui_style", true]],
        ["white_unchecked_hover", ["other_ore-ui_style", true]],
    ]);

    async function loadModules() {
        if (modulesPromise) return modulesPromise;

        modulesPromise = Promise.all([
            import("./dist/index.js"),
            import("./dist/CONFIG.js"),
            import("./dist/upload.js"),
            import("./dist/elements/panel.js"),
            import("./dist/elements/canvas.js"),
            import("./dist/elements/collectionPanel.js"),
            import("./dist/elements/label.js"),
            import("./dist/elements/button.js"),
            import("./dist/files/openFiles.js"),
            import("./dist/ui/propertiesArea.js"),
            import("./dist/ui/modals/chooseImage.js"),
            import("./dist/converterTypes/HTMLClassToJonUITypes.js"),
            import("./dist/elements/sharedElement.js"),
        ]).then(([
            index,
            configMod,
            uploadMod,
            panelMod,
            canvasMod,
            collectionMod,
            labelMod,
            buttonMod,
            filesMod,
            propsMod,
            chooseMod,
            converterTypesMod,
            sharedMod,
        ]) => ({
            index,
            config: configMod.config,
            FormUploader: uploadMod.FormUploader,
            DraggablePanel: panelMod.DraggablePanel,
            DraggableCanvas: canvasMod.DraggableCanvas,
            DraggableCollectionPanel: collectionMod.DraggableCollectionPanel,
            DraggableLabel: labelMod.DraggableLabel,
            DraggableButton: buttonMod.DraggableButton,
            FileUploader: filesMod.FileUploader,
            propertiesMap: propsMod.propertiesMap,
            updatePropertiesArea: propsMod.updatePropertiesArea,
            chooseImageModal: chooseMod.chooseImageModal,
            classToJsonUI: converterTypesMod.classToJsonUI,
            ElementSharedFuncs: sharedMod.ElementSharedFuncs,
        }));

        return modulesPromise;
    }

    // ============================================================
    // Touch + pinch
    // ============================================================

    function makeMouseEvent(type, source, x, y) {
        const event = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            detail: type === "dblclick" ? 2 : 1,
            clientX: x ?? source?.clientX ?? 0,
            clientY: y ?? source?.clientY ?? 0,
            screenX: source?.screenX ?? 0,
            screenY: source?.screenY ?? 0,
            ctrlKey: source?.ctrlKey ?? false,
            shiftKey: source?.shiftKey ?? false,
            altKey: source?.altKey ?? false,
            metaKey: source?.metaKey ?? false,
            button: 0,
            buttons: type === "mouseup" || type === "dblclick" ? 0 : 1,
        });

        syntheticMouseEvents.add(event);
        return event;
    }

    function dispatchMouse(target, type, source, x, y) {
        if (!(target instanceof EventTarget)) return;
        target.dispatchEvent(makeMouseEvent(type, source, x, y));
    }

    function blockCompatibilityMouse(event) {
        if (syntheticMouseEvents.has(event)) return;
        if (Date.now() > suppressCompatMouseUntil) return;
        if (!(event.target instanceof Node)) return;
        if (!mainWindow?.contains(event.target)) return;

        event.preventDefault();
        event.stopImmediatePropagation();
    }

    function resetGesture() {
        if (downTarget instanceof Element && activePointerId !== null) {
            try {
                if (downTarget.hasPointerCapture?.(activePointerId)) {
                    downTarget.releasePointerCapture(activePointerId);
                }
            } catch (_) {}
        }

        activePointerId = null;
        downTarget = null;
        dragStarted = false;
    }

    function editableControl(target) {
        return (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement ||
            (target instanceof HTMLElement && target.isContentEditable)
        );
    }

    function pointerDown(event) {
        if (event.pointerType === "mouse") return;

        if (event.pointerType === "touch") {
            activeTouches.add(event.pointerId);

            if (activeTouches.size >= 2) {
                nativePinch = true;

                if (activePointerId !== null) {
                    if (dragStarted && downTarget instanceof EventTarget) {
                        dispatchMouse(
                            downTarget,
                            "mouseup",
                            event,
                            lastX,
                            lastY
                        );
                    }

                    resetGesture();
                }

                return;
            }
        }

        if (!editMode || nativePinch || activePointerId !== null) return;
        if (!(event.target instanceof Node)) return;
        if (!mainWindow?.contains(event.target)) return;

        activePointerId = event.pointerId;
        downTarget = event.target;
        downX = lastX = event.clientX;
        downY = lastY = event.clientY;
        dragStarted = false;

        try {
            if (downTarget instanceof Element) {
                downTarget.setPointerCapture?.(event.pointerId);
            }
        } catch (_) {}

        if (!editableControl(event.target)) {
            suppressCompatMouseUntil = Date.now() + COMPAT_MOUSE_BLOCK_MS;

            if (activeTouches.size < 2) {
                event.preventDefault();
            }
        }
    }

    function pointerMove(event) {
        if (event.pointerType === "mouse") return;
        if (nativePinch || activeTouches.size >= 2) return;
        if (event.pointerId !== activePointerId) return;
        if (!(downTarget instanceof EventTarget)) return;

        lastX = event.clientX;
        lastY = event.clientY;

        if (
            !dragStarted &&
            Math.hypot(lastX - downX, lastY - downY) >= DRAG_THRESHOLD
        ) {
            dragStarted = true;
            suppressCompatMouseUntil = Date.now() + COMPAT_MOUSE_BLOCK_MS;
            dispatchMouse(downTarget, "mousedown", event, downX, downY);
        }

        if (!dragStarted) return;

        event.preventDefault();
        dispatchMouse(
            downTarget,
            "mousemove",
            event,
            lastX,
            lastY
        );
    }

    function pointerUp(event) {
        if (event.pointerType === "touch") {
            activeTouches.delete(event.pointerId);

            if (nativePinch) {
                if (activeTouches.size === 0) nativePinch = false;
                return;
            }
        }

        if (event.pointerType === "mouse") return;
        if (event.pointerId !== activePointerId) return;

        const target = downTarget;
        const moved =
            Math.hypot(
                event.clientX - downX,
                event.clientY - downY
            );

        if (dragStarted && target instanceof EventTarget) {
            event.preventDefault();
            dispatchMouse(
                target,
                "mouseup",
                event,
                event.clientX,
                event.clientY
            );
        } else if (
            moved < DRAG_THRESHOLD &&
            target instanceof Element &&
            !target.closest(".resize-handle")
        ) {
            queueMicrotask(() => {
                dispatchMouse(
                    target,
                    "dblclick",
                    event,
                    event.clientX,
                    event.clientY
                );
            });
        }

        resetGesture();
    }

    function pointerCancel(event) {
        if (event.pointerType === "touch") {
            activeTouches.delete(event.pointerId);
            if (activeTouches.size === 0) nativePinch = false;
        }

        if (event.pointerId !== activePointerId) return;

        if (dragStarted && downTarget instanceof EventTarget) {
            dispatchMouse(
                downTarget,
                "mouseup",
                event,
                lastX,
                lastY
            );
        }

        resetGesture();
    }

    function explorerPointerUp(event) {
        if (!editMode || event.pointerType === "mouse") return;
        if (!(event.target instanceof Element)) return;

        const text = event.target.closest(".explorerText");
        if (!text) return;

        dispatchMouse(
            text,
            "dblclick",
            event,
            event.clientX,
            event.clientY
        );
    }

    function installTouchModeButton() {
        if (!hasTouch || document.querySelector(".rag-touch-toggle")) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "rag-touch-toggle";

        const render = () => {
            document.body.classList.toggle(
                "rag-touch-edit",
                editMode
            );

            document.body.classList.toggle(
                "rag-touch-nav",
                !editMode
            );

            button.innerHTML = editMode
                ? "TOUCH: EDITAR<small>1 dedo edita • 2 dedos zoom</small>"
                : "TOUCH: NAVEGAR<small>mover pagina • pinça zoom</small>";
        };

        button.addEventListener("click", () => {
            editMode = !editMode;
            if (!editMode) resetGesture();
            render();
        });

        render();
        document.body.appendChild(button);
    }

    // ============================================================
    // GRID V14 - reliable overlay above images
    // ============================================================

    function patchGridSystem(mods) {
        const shared = mods.ElementSharedFuncs;

        if (!shared || shared.__ragGridV14) return;
        shared.__ragGridV14 = true;

        const originalGrid = shared.grid;
        const originalSelect = shared.select;
        const originalUnselect = shared.unSelect;
        const originalStopDrag = shared.stopDrag;

        shared.grid = function (showGrid, classElement) {
            originalGrid.call(this, showGrid, classElement);

            const grid = classElement?.gridElement;
            if (!grid) return;

            grid.classList.toggle(
                "rag-grid-visible",
                Boolean(showGrid)
            );

            grid.style.pointerEvents = "none";
            grid.style.zIndex =
                showGrid ? "2147482000" : "";
        };

        shared.select = function (event, classElement) {
            const result =
                originalSelect.call(
                    this,
                    event,
                    classElement
                );

            if (
                mods.config.settings.show_grid?.value &&
                typeof classElement?.grid === "function"
            ) {
                classElement.grid(true);
            }

            return result;
        };

        shared.unSelect = function (classElement) {
            if (
                typeof classElement?.grid === "function"
            ) {
                classElement.grid(false);
            }

            return originalUnselect.call(
                this,
                classElement
            );
        };

        shared.stopDrag = function (classElement) {
            const parent = classElement?.container;

            const result =
                originalStopDrag.call(
                    this,
                    classElement
                );

            // Original code always hides the parent grid after drag,
            // even when "Show Grid" is enabled. Restore it.
            if (
                mods.config.settings.show_grid?.value &&
                parent?.dataset?.id
            ) {
                const parentInstance =
                    mods.index.GLOBAL_ELEMENT_MAP.get(
                        parent.dataset.id
                    );

                if (
                    typeof parentInstance?.grid === "function"
                ) {
                    parentInstance.grid(true);
                }
            }

            return result;
        };
    }

    // ============================================================
    // Image selected-parent lock
    // ============================================================

    function looksSelected(element) {
        const outline =
            `${element?.style?.outline || ""} ${element?.style?.outlineColor || ""}`
                .toLowerCase();

        return (
            outline.includes("blue") ||
            outline.includes("rgb(0, 0, 255)") ||
            outline.includes("rgb(0,0,255)")
        );
    }

    function selectedMainElement() {
        const candidates = [
            ...document.querySelectorAll(
                "#main_window [data-id]"
            ),
        ].filter((el) => {
            if (!(el instanceof HTMLElement)) return false;
            if (el.dataset.skip === "true") return false;

            return (
                el.classList.contains("draggable-panel") ||
                el.classList.contains("draggable-canvas") ||
                el.classList.contains("draggable-button") ||
                el.classList.contains("draggable-collection_panel") ||
                el.classList.contains("draggable-scrolling_panel") ||
                el.classList.contains("draggable-label")
            );
        });

        for (let i = candidates.length - 1; i >= 0; i--) {
            if (looksSelected(candidates[i])) return candidates[i];
        }

        return null;
    }

    function isValidImageContainer(element) {
        if (!(element instanceof HTMLElement)) return false;

        return (
            element.classList.contains("draggable-panel") ||
            element.classList.contains("draggable-collection_panel") ||
            element.classList.contains("draggable-scrolling_panel")
        );
    }

    function resolveImageContainer() {
        let selected = selectedMainElement();

        if (!selected) return null;

        if (isValidImageContainer(selected)) {
            return selected;
        }

        // If the user selected an image/label/button INSIDE a panel,
        // use its nearest real container instead of attaching the new image
        // to the child itself.
        let current = selected.parentElement;

        while (
            current &&
            current.id !== "main_window"
        ) {
            if (isValidImageContainer(current)) {
                return current;
            }

            current = current.parentElement;
        }

        return null;
    }

    function restoreImageParent() {
        if (!(imageParentLock instanceof HTMLElement)) return;
        if (!document.contains(imageParentLock)) return;
        if (looksSelected(imageParentLock)) return;

        const rect = imageParentLock.getBoundingClientRect();

        dispatchMouse(
            imageParentLock,
            "dblclick",
            null,
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
        );
    }

    async function installImageParentLock() {
        const mods = await loadModules();
        const Builder = window.Builder;

        if (!Builder || Builder.__ragParentLockV11) return;
        Builder.__ragParentLockV11 = true;

        const oldOpen = Builder.openAddImageMenu;
        const oldAdd = Builder.addCanvas;

        Builder.openAddImageMenu = async function (...args) {
            const previous = imageParentLock;
            imageParentLock = resolveImageContainer() || selectedMainElement();

            try {
                return await oldOpen.apply(this, args);
            } finally {
                imageParentLock = previous;
            }
        };

        Builder.addCanvas = function (...args) {
            restoreImageParent();

            // V19: stretch removed. Always create a normal image.
            if (args.length >= 3) {
                args[2] = undefined;
            }

            return oldAdd.apply(this, args);
        };
    }

    // ============================================================
    // Generic file picker / gallery import
    // ============================================================

    function cleanImageName(name) {
        return (
            String(name || "image")
                .replace(/\.[^.]+$/, "")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-zA-Z0-9_-]+/g, "_")
                .replace(/^_+|_+$/g, "")
                .toLowerCase() || "image"
        );
    }

    function uniqueImageKey(images, name) {
        const base = `gallery/${cleanImageName(name)}`;
        let key = base;
        let n = 2;

        while (images.has(key)) {
            key = `${base}_${n++}`;
        }

        return key;
    }

    function fileDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () =>
                reject(reader.error || new Error("Falha ao ler imagem."));

            reader.readAsDataURL(file);
        });
    }

    async function fileImageData(file) {
        const url = URL.createObjectURL(file);

        try {
            const image = new Image();

            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () =>
                    reject(new Error("Arquivo de imagem invalido."));
                image.src = url;
            });

            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth || image.width;
            canvas.height = image.naturalHeight || image.height;

            const ctx = canvas.getContext("2d", {
                willReadFrequently: true,
            });

            ctx.drawImage(image, 0, 0);

            return ctx.getImageData(
                0,
                0,
                canvas.width,
                canvas.height
            );
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    function persistImage(key, file, dataUrl) {
        try {
            localStorage.setItem(
                `asset_${key}_png`,
                JSON.stringify({
                    base64: dataUrl,
                    metadata: {
                        name: file.name,
                        relativePath: `textures/${key}.png`,
                        importedFromFiles: true,
                    },
                })
            );
        } catch (_) {}
    }

    function chooseImportedImage(form, key) {
        const row = document.createElement("div");
        row.className = "explorerDiv";

        const text = document.createElement("div");
        text.className = "explorerText";
        text.textContent = key;

        row.appendChild(text);
        form.prepend(row);

        requestAnimationFrame(() => text.click());
    }

    async function importChosenFile(wrapper, file) {
        const valid =
            /\.(png|jpe?g|webp)$/i.test(file.name || "") ||
            /^image\/(png|jpeg|webp)$/i.test(file.type || "");

        const status = wrapper.querySelector(".rag-file-status");

        if (!valid) {
            status.textContent = "Use PNG, JPG, JPEG ou WEBP.";
            status.dataset.kind = "error";
            return;
        }

        const mods = await loadModules();
        const [imageData, dataUrl] = await Promise.all([
            fileImageData(file),
            fileDataUrl(file),
        ]);

        const key = uniqueImageKey(mods.index.images, file.name);

        mods.index.images.set(key, {
            png: imageData,
        });

        persistImage(key, file, dataUrl);

        status.textContent = `Importada: ${file.name}`;
        status.dataset.kind = "success";

        const form =
            document.querySelector(
                "#modalChooseImage .modalChooseImageForm"
            );

        if (form) chooseImportedImage(form, key);
    }

    function installFilePicker() {
        const modal = document.getElementById("modalChooseImage");
        const content = modal?.querySelector(".modal-content");
        const form = modal?.querySelector(".modalChooseImageForm");

        if (!modal || !content || !form) {
            setTimeout(installFilePicker, 100);
            return;
        }

        if (content.querySelector(".rag-file-picker")) return;

        const wrapper = document.createElement("div");
        wrapper.className = "rag-file-picker";

        const filesButton = document.createElement("button");
        filesButton.type = "button";
        filesButton.textContent = "ESCOLHER ARQUIVO";

        const filesInput = document.createElement("input");
        filesInput.type = "file";
        filesInput.style.display = "none";
        // No accept attribute on purpose: Android shows Documents providers.

        const galleryButton = document.createElement("button");
        galleryButton.type = "button";
        galleryButton.textContent = "ABRIR GALERIA";
        galleryButton.className = "secondary";

        const galleryInput = document.createElement("input");
        galleryInput.type = "file";
        galleryInput.accept = "image/png,image/jpeg,image/webp";
        galleryInput.style.display = "none";

        const status = document.createElement("div");
        status.className = "rag-file-status";
        status.textContent =
            "Arquivos, ZArchiver, ES File Explorer ou Galeria";

        filesButton.addEventListener("click", () => {
            filesInput.value = "";
            filesInput.click();
        });

        galleryButton.addEventListener("click", () => {
            galleryInput.value = "";
            galleryInput.click();
        });

        filesInput.addEventListener("change", async () => {
            const file = filesInput.files?.[0];
            if (!file) return;

            try {
                await importChosenFile(wrapper, file);
            } catch (error) {
                status.textContent =
                    `Erro: ${error?.message || error}`;
                status.dataset.kind = "error";
            }
        });

        galleryInput.addEventListener("change", async () => {
            const file = galleryInput.files?.[0];
            if (!file) return;

            try {
                await importChosenFile(wrapper, file);
            } catch (error) {
                status.textContent =
                    `Erro: ${error?.message || error}`;
                status.dataset.kind = "error";
            }
        });

        wrapper.append(
            filesButton,
            galleryButton,
            status,
            filesInput,
            galleryInput
        );

        content.insertBefore(wrapper, form);
    }

    // ============================================================
    // Image free resize + geometry-preserving texture replacement
    // ============================================================

    function currentBox(instance) {
        const el = instance.canvasHolder;
        const rect = el.getBoundingClientRect();

        const width =
            parseFloat(el.style.width) ||
            rect.width ||
            1;

        const height =
            parseFloat(el.style.height) ||
            rect.height ||
            1;

        return {
            width,
            height,
            left: el.style.left,
            top: el.style.top,
            layer: el.style.zIndex,
            keepAspect: el.dataset.ragKeepAspect ?? "false",
            boxRatio: width / Math.max(1, height),
        };
    }

    function restoreBox(instance, box) {
        instance.drawImage(
            box.width,
            box.height,
            false
        );

        const el = instance.canvasHolder;
        el.style.left = box.left;
        el.style.top = box.top;
        el.style.zIndex = box.layer;
        el.dataset.ragKeepAspect = box.keepAspect;

        // Locked resize follows the CURRENT element box, not new PNG pixels.
        instance.aspectRatio = box.boxRatio;
    }

    async function installImageResizeAndReplacement() {
        const mods = await loadModules();
        const Canvas = mods.DraggableCanvas;

        if (!Canvas.prototype.__ragV11ImagePatch) {
            Canvas.prototype.__ragV11ImagePatch = true;

            const originalResize = Canvas.prototype.resize;
            const originalChange = Canvas.prototype.changeImage;
            const originalDrawImage = Canvas.prototype.drawImage;

            Canvas.prototype.drawImage = function (...args) {
                this.nineSlice = undefined;
                return originalDrawImage.apply(this, args);
            };

            Canvas.prototype.resize = function (event) {
                if (
                    this.canvasHolder.dataset.ragKeepAspect === "true"
                ) {
                    return originalResize.call(this, event);
                }

                if (!this.isResizing || !this.isEditable) return;

                event.stopPropagation();

                const container =
                    this.container.getBoundingClientRect();

                let width =
                    this.resizeStartWidth +
                    (event.clientX - this.resizeStartX);

                let height =
                    this.resizeStartHeight +
                    (event.clientY - this.resizeStartY);

                width = Math.max(1, width);
                height = Math.max(1, height);

                const outline =
                    parseFloat(
                        getComputedStyle(this.outlineDiv).outlineWidth
                    ) || 0;

                this.outlineDiv.style.width =
                    `${Math.max(1, width - outline)}px`;

                this.outlineDiv.style.height =
                    `${Math.max(1, height - outline)}px`;
            };

            Canvas.prototype.changeImage = function (path) {
                const state = mods.index.images.get(path);
                if (!state?.png) return;

                const box = currentBox(this);

                // Ignore any legacy .json nine-slice sidecar.
                const savedJson = state.json;
                state.json = undefined;

                try {
                    originalChange.call(this, path);
                } finally {
                    state.json = savedJson;
                }

                this.nineSlice = undefined;
                restoreBox(this, box);

                this.canvasHolder.dataset.imagePath = path;
                this.canvasHolder.dataset.ragFallbackActive =
                    state.__ragFallback ? "true" : "false";
            };
        }

        const props =
            mods.propertiesMap.get("draggable-canvas");

        if (Array.isArray(props) && !props.__ragV11Sizing) {
            props.__ragV11Sizing = true;

            const widthProp =
                props.find((p) => p.displayName === "Width");

            const heightProp =
                props.find((p) => p.displayName === "Height");

            const fillProp =
                props.find((p) => p.displayName === "Fill Parent");

            if (widthProp) {
                widthProp.set = (element, value) => {
                    const instance =
                        mods.index.GLOBAL_ELEMENT_MAP.get(
                            element.dataset.id
                        );

                    if (!instance) return;

                    const box = currentBox(instance);
                    const width = Math.max(1, parseFloat(value) || 1);

                    if (
                        element.dataset.ragKeepAspect === "true"
                    ) {
                        instance.drawImage(
                            width,
                            width / instance.aspectRatio,
                            false
                        );
                    } else {
                        instance.drawImage(
                            width,
                            box.height,
                            false
                        );
                    }
                };
            }

            if (heightProp) {
                heightProp.set = (element, value) => {
                    const instance =
                        mods.index.GLOBAL_ELEMENT_MAP.get(
                            element.dataset.id
                        );

                    if (!instance) return;

                    const box = currentBox(instance);
                    const height = Math.max(1, parseFloat(value) || 1);

                    if (
                        element.dataset.ragKeepAspect === "true"
                    ) {
                        instance.drawImage(
                            height * instance.aspectRatio,
                            height,
                            false
                        );
                    } else {
                        instance.drawImage(
                            box.width,
                            height,
                            false
                        );
                    }
                };
            }

            if (fillProp) {
                fillProp.set = (element) => {
                    const instance =
                        mods.index.GLOBAL_ELEMENT_MAP.get(
                            element.dataset.id
                        );

                    if (!instance) return;

                    const rect =
                        instance.container.getBoundingClientRect();

                    element.style.left = "0px";
                    element.style.top = "0px";
                    instance.drawImage(
                        rect.width,
                        rect.height,
                        false
                    );

                    instance.aspectRatio =
                        rect.width / Math.max(1, rect.height);
                };
            }
        }
    }

    // ============================================================
    // Texture resolver - lazy, on demand
    // ============================================================

    function normalizeTexture(path) {
        return String(path || "")
            .replace(/^textures\//i, "")
            .replace(/\.(png|jpg|jpeg|webp|tga|json)$/i, "")
            .replace(/^\/+/, "");
    }

    function baseName(path) {
        return (
            normalizeTexture(path)
                .split("/")
                .pop()
                ?.toLowerCase() || ""
        );
    }

    function makeFallbackImageData(label) {
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;

        const ctx = canvas.getContext("2d", {
            willReadFrequently: true,
        });

        for (let y = 0; y < 128; y += 16) {
            for (let x = 0; x < 128; x += 16) {
                ctx.fillStyle =
                    ((x / 16 + y / 16) % 2)
                        ? "#202024"
                        : "#d100d1";
                ctx.fillRect(x, y, 16, 16);
            }
        }

        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(18, 18);
        ctx.lineTo(110, 110);
        ctx.moveTo(110, 18);
        ctx.lineTo(18, 110);
        ctx.stroke();

        ctx.fillStyle = "rgba(0,0,0,.82)";
        ctx.fillRect(0, 92, 128, 36);

        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
            baseName(label).slice(0, 18) || "MISSING",
            64,
            113
        );

        return ctx.getImageData(0, 0, 128, 128);
    }

    function findLoadedByBasename(images, requested) {
        const base = baseName(requested);
        if (!base) return null;

        for (const [key, state] of images.entries()) {
            if (!state?.png || state.__ragFallback) continue;
            if (baseName(key) === base) return state;
        }

        return null;
    }

    async function fetchImageState(setName, fileName, nineSlice) {
        const url =
            `presets/textures/${setName}/${fileName}.png`;

        const response = await fetch(url, {
            cache: "force-cache",
        });

        if (!response.ok) return null;

        const file = new File(
            [await response.blob()],
            `${fileName}.png`
        );

        const png = await fileImageData(file);
        let json;

        if (nineSlice) {
            try {
                const jsonResponse = await fetch(
                    `presets/textures/${setName}/${fileName}.json`,
                    { cache: "force-cache" }
                );

                if (jsonResponse.ok) {
                    json = await jsonResponse.json();
                }
            } catch (_) {}
        }

        return {
            png,
            json,
            __ragBuiltin: setName,
        };
    }

    async function ensureTexture(path) {
        const mods = await loadModules();
        const images = mods.index.images;
        const requested = normalizeTexture(path);

        const exact = images.get(requested);

        if (exact?.png && !exact.__ragFallback) {
            universalState.missingPaths.delete(requested);
            return exact;
        }

        const loaded = findLoadedByBasename(
            images,
            requested
        );

        if (loaded) {
            images.set(requested, loaded);
            universalState.missingPaths.delete(requested);
            return loaded;
        }

        const base = baseName(requested);
        const catalog = PRESET_CATALOG.get(base);

        if (catalog) {
            const [setName, nineSlice, actualName] = catalog;
            const state = await fetchImageState(
                setName,
                actualName || base,
                nineSlice
            );

            if (state?.png) {
                images.set(requested, state);
                images.set(
                    `presets/textures/${setName}/${actualName || base}`,
                    state
                );

                universalState.missingPaths.delete(requested);
                return state;
            }
        }

        const fallback = {
            png: makeFallbackImageData(requested),
            __ragFallback: true,
            __ragRequestedPath: requested,
        };

        images.set(requested, fallback);
        universalState.missingPaths.add(requested);

        return fallback;
    }

    function collectTexturePaths(value, out = new Set(), seen = new WeakSet()) {
        if (!value || typeof value !== "object") return out;
        if (seen.has(value)) return out;
        seen.add(value);

        if (Array.isArray(value)) {
            for (const item of value) {
                collectTexturePaths(item, out, seen);
            }

            return out;
        }

        for (const [key, child] of Object.entries(value)) {
            if (
                typeof child === "string" &&
                /texture/i.test(key) &&
                !child.startsWith("$") &&
                !child.startsWith("#") &&
                child !== "loading"
            ) {
                out.add(normalizeTexture(child));
            }

            if (child && typeof child === "object") {
                collectTexturePaths(child, out, seen);
            }
        }

        return out;
    }

    async function prepareTextures(parsed) {
        const paths = [...collectTexturePaths(parsed)];

        // Small batches avoid locking the mobile main thread/network queue.
        for (let i = 0; i < paths.length; i += 4) {
            await Promise.all(
                paths.slice(i, i + 4).map((path) =>
                    ensureTexture(path)
                )
            );

            // Yield to browser between batches.
            await new Promise((resolve) =>
                requestAnimationFrame(resolve)
            );
        }
    }

    // ============================================================
    // JSON parsing + hybrid importer
    // ============================================================

    function parseJsonc(raw) {
        raw = String(raw || "").replace(/^\uFEFF/, "");

        let out = "";
        let inString = false;
        let escaped = false;
        let lineComment = false;
        let blockComment = false;

        for (let i = 0; i < raw.length; i++) {
            const c = raw[i];
            const n = raw[i + 1];

            if (lineComment) {
                if (c === "\n") {
                    lineComment = false;
                    out += c;
                } else {
                    out += " ";
                }
                continue;
            }

            if (blockComment) {
                if (c === "*" && n === "/") {
                    blockComment = false;
                    out += "  ";
                    i++;
                } else {
                    out += c === "\n" ? "\n" : " ";
                }
                continue;
            }

            if (inString) {
                out += c;

                if (escaped) {
                    escaped = false;
                } else if (c === "\\") {
                    escaped = true;
                } else if (c === '"') {
                    inString = false;
                }

                continue;
            }

            if (c === '"') {
                inString = true;
                out += c;
                continue;
            }

            if (c === "/" && n === "/") {
                lineComment = true;
                out += "  ";
                i++;
                continue;
            }

            if (c === "/" && n === "*") {
                blockComment = true;
                out += "  ";
                i++;
                continue;
            }

            out += c;
        }

        return JSON.parse(
            out.replace(/,\s*([}\]])/g, "$1")
        );
    }

    function isNativeEditorJson(parsed) {
        const namespace = parsed?.namespace;

        return Boolean(
            typeof namespace === "string" &&
            parsed?.[namespace] &&
            parsed?.config?.magicNumbers &&
            Number.isFinite(
                Number(parsed.config.magicNumbers.UI_SCALAR)
            )
        );
    }

    function sanitizeNamespace(value) {
        let out =
            String(value || "imported_ui")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .replace(/[^a-z0-9_]+/g, "_")
                .replace(/^_+|_+$/g, "") || "imported_ui";

        if (/^\d/.test(out)) out = `ui_${out}`;
        return out;
    }

    function clone(value) {
        if (value == null || typeof value !== "object") return value;
        if (Array.isArray(value)) return value.map(clone);

        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = clone(v);
        }
        return out;
    }

    function merge(base, local) {
        if (!base || typeof base !== "object") return clone(local);
        if (!local || typeof local !== "object") return clone(base);
        if (Array.isArray(base) || Array.isArray(local)) {
            return clone(local);
        }

        const out = clone(base);

        for (const [key, value] of Object.entries(local)) {
            if (
                value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                out[key] &&
                typeof out[key] === "object" &&
                !Array.isArray(out[key])
            ) {
                out[key] = merge(out[key], value);
            } else {
                out[key] = clone(value);
            }
        }

        return out;
    }

    function splitControlKey(key) {
        const index = String(key).indexOf("@");

        return index === -1
            ? { name: String(key), ref: null }
            : {
                name: String(key).slice(0, index),
                ref: String(key).slice(index + 1),
            };
    }

    function localDefinition(ref) {
        if (!ref || !universalState.parsed) return null;

        const parts = String(ref).split(".");
        let namespace;
        let key;

        if (parts.length === 1) {
            namespace = universalState.namespace;
            key = parts[0];
        } else {
            namespace = parts.shift();
            key = parts.join(".");
        }

        if (
            namespace !== universalState.namespace &&
            namespace !== universalState.parsed.namespace
        ) {
            return null;
        }

        return universalState.parsed[key] || null;
    }

    function variables(json, parent = {}) {
        const out = { ...parent };

        if (!json || typeof json !== "object") return out;

        for (const [key, value] of Object.entries(json)) {
            if (key.startsWith("$")) {
                out[key.split("|")[0]] = value;
            }
        }

        return out;
    }

    function resolveVariable(value, vars, depth = 0) {
        if (depth > 10) return value;

        if (
            typeof value === "string" &&
            value.startsWith("$") &&
            Object.prototype.hasOwnProperty.call(
                vars,
                value.split("|")[0]
            )
        ) {
            return resolveVariable(
                vars[value.split("|")[0]],
                vars,
                depth + 1
            );
        }

        if (Array.isArray(value)) {
            return value.map((item) =>
                resolveVariable(item, vars, depth + 1)
            );
        }

        return value;
    }

    function uiScalar(mods) {
        return (
            Number(mods.config.magicNumbers.UI_SCALAR) ||
            0.36
        );
    }

    function dimension(value, parent, vars, fallback, mods) {
        value = resolveVariable(value, vars);

        if (typeof value === "number" && Number.isFinite(value)) {
            return value / uiScalar(mods);
        }

        if (typeof value !== "string") return fallback;

        const text = value
            .trim()
            .toLowerCase()
            .replace(/%c/g, "%");

        const expression = text.match(
            /^(-?\d+(?:\.\d+)?)%\s*([+-])?\s*(-?\d+(?:\.\d+)?)?(?:px)?$/
        );

        if (expression) {
            let result =
                parent * Number(expression[1]) / 100;

            if (expression[2] && expression[3]) {
                const delta =
                    Number(expression[3]) / uiScalar(mods);

                result +=
                    expression[2] === "+"
                        ? delta
                        : -delta;
            }

            return result;
        }

        const px = text.match(
            /^(-?\d+(?:\.\d+)?)px$/
        );

        if (px) {
            return Number(px[1]) / uiScalar(mods);
        }

        const numeric = Number(text);

        if (Number.isFinite(numeric)) {
            return numeric / uiScalar(mods);
        }

        return fallback;
    }

    function pair(value, parentW, parentH, vars, fallback, mods) {
        value = resolveVariable(value, vars);

        if (!Array.isArray(value)) return [...fallback];

        return [
            dimension(
                value[0],
                parentW,
                vars,
                fallback[0],
                mods
            ),
            dimension(
                value[1],
                parentH,
                vars,
                fallback[1],
                mods
            ),
        ];
    }

    const ANCHOR = {
        top_left: [0, 0],
        top_middle: [0.5, 0],
        top_right: [1, 0],
        left_middle: [0, 0.5],
        center: [0.5, 0.5],
        right_middle: [1, 0.5],
        bottom_left: [0, 1],
        bottom_middle: [0.5, 1],
        bottom_right: [1, 1],
    };

    function anchor(name) {
        return (
            ANCHOR[String(name || "").toLowerCase()] ||
            ANCHOR.center
        );
    }

    function geometry(element, json, vars, parent, mods, fallback) {
        const rect = parent.getBoundingClientRect();
        const widthParent = rect.width || 1500;
        const heightParent = rect.height || 844;

        const size = pair(
            json.size,
            widthParent,
            heightParent,
            vars,
            fallback,
            mods
        );

        const offset = pair(
            json.offset,
            widthParent,
            heightParent,
            vars,
            [0, 0],
            mods
        );

        const from = anchor(
            resolveVariable(
                json.anchor_from || json.anchor_to,
                vars
            )
        );

        const to = anchor(
            resolveVariable(
                json.anchor_to || "center",
                vars
            )
        );

        const width = Math.max(1, size[0]);
        const height = Math.max(1, size[1]);

        element.style.width = `${width}px`;
        element.style.height = `${height}px`;

        element.style.left =
            `${
                widthParent * to[0] +
                offset[0] -
                width * from[0]
            }px`;

        element.style.top =
            `${
                heightParent * to[1] +
                offset[1] -
                height * from[1]
            }px`;

        if (Number.isFinite(Number(json.layer))) {
            element.style.zIndex = String(json.layer);
        }

        return { width, height };
    }

    function inferredType(name, json) {
        const type =
            String(json?.type || "").toLowerCase();

        if (type) return type;

        const lower = String(name || "").toLowerCase();

        if (json?.texture !== undefined) return "image";
        if (json?.text !== undefined) return "label";
        if (json?.collection_name !== undefined) {
            return "collection_panel";
        }

        if (lower.includes("image")) return "image";
        if (lower.includes("label")) return "label";

        return "panel";
    }

    function newId() {
        return (
            crypto.randomUUID?.()
                ?.replace(/-/g, "")
                .slice(0, 15) ||
            Math.random().toString(36).slice(2, 17)
        );
    }

    function bindingsString(json) {
        return Array.isArray(json?.bindings)
            ? JSON.stringify(json.bindings, null, 4)
            : "";
    }

    async function createExternalControl(
        parentClass,
        rawKey,
        rawValue,
        parentVars,
        stack,
        mods
    ) {
        const { name, ref } = splitControlKey(rawKey);

        let json =
            rawValue && typeof rawValue === "object"
                ? clone(rawValue)
                : {};

        if (ref && !stack.has(ref)) {
            const base = localDefinition(ref);
            if (base) json = merge(base, json);
        }

        const vars = variables(json, parentVars);
        const type = inferredType(name, json);

        let instance;
        const parent = parentClass.getMainHTMLElement();

        if (type === "image") {
            const requested =
                normalizeTexture(
                    resolveVariable(
                        json.texture,
                        vars
                    ) || "__rag/dynamic_texture"
                );

            const state = await ensureTexture(requested);
            const id = newId();

            instance = new mods.DraggableCanvas(
                id,
                parent,
                state.png,
                requested,
                undefined
            );

            mods.index.GLOBAL_ELEMENT_MAP.set(id, instance);

            const box = geometry(
                instance.canvasHolder,
                json,
                vars,
                parent,
                mods,
                [160, 100]
            );

            instance.drawImage(
                box.width,
                box.height,
                false
            );

            instance.canvasHolder.dataset.ragKeepAspect = "false";
            instance.canvasHolder.dataset.ragFallbackActive =
                state.__ragFallback ? "true" : "false";
            instance.bindings = bindingsString(json);
        } else if (type === "label") {
            const id = newId();

            const fontScale =
                Number(
                    resolveVariable(
                        json.font_scale_factor,
                        vars
                    )
                ) || 1;

            const editorScale =
                uiScalar(mods) *
                (
                    Number(
                        mods.config.magicNumbers.fontScalar
                    ) || 1.6
                );

            instance = new mods.DraggableLabel(
                id,
                parent,
                {
                    text:
                        String(
                            resolveVariable(
                                json.text,
                                vars
                            ) ?? "Label"
                        ),
                    includeTextPrompt: true,
                    fontScale:
                        Math.max(0.1, fontScale / editorScale),
                    textAlign:
                        resolveVariable(
                            json.text_alignment,
                            vars
                        ) || "left",
                }
            );

            mods.index.GLOBAL_ELEMENT_MAP.set(id, instance);

            const rect = parent.getBoundingClientRect();
            const offset = pair(
                json.offset,
                rect.width,
                rect.height,
                vars,
                [0, 0],
                mods
            );

            const from = anchor(
                resolveVariable(
                    json.anchor_from || json.anchor_to,
                    vars
                )
            );

            const to = anchor(
                resolveVariable(
                    json.anchor_to || "center",
                    vars
                )
            );

            instance.updateSize(false);

            const labelRect =
                instance.label.getBoundingClientRect();

            instance.label.style.left =
                `${
                    rect.width * to[0] +
                    offset[0] -
                    labelRect.width * from[0]
                }px`;

            instance.label.style.top =
                `${
                    rect.height * to[1] +
                    offset[1] -
                    labelRect.height * from[1]
                }px`;

            const font = resolveVariable(
                json.font_type,
                vars
            );

            if (font) {
                instance.label.style.fontFamily = font;
                instance.mirror.style.fontFamily = font;
                instance.shadowLabel.style.fontFamily = font;
            }

            if (json.shadow !== undefined) {
                instance.shadow(
                    Boolean(
                        resolveVariable(json.shadow, vars)
                    )
                );
            }

            instance.bindings = bindingsString(json);
        } else if (type === "collection_panel") {
            const id = newId();

            instance =
                new mods.DraggableCollectionPanel(
                    id,
                    parent
                );

            mods.index.GLOBAL_ELEMENT_MAP.set(id, instance);

            geometry(
                instance.panel,
                json,
                vars,
                parent,
                mods,
                [180, 90]
            );

            instance.panel.dataset.collectionName =
                String(
                    resolveVariable(
                        json.collection_name,
                        vars
                    ) || "form_buttons"
                );

            if (json.collection_index !== undefined) {
                instance.panel.dataset.collectionIndex =
                    String(
                        resolveVariable(
                            json.collection_index,
                            vars
                        )
                    );
            }

            instance.bindings = bindingsString(json);
        } else {
            const id = newId();

            instance = new mods.DraggablePanel(
                id,
                parent
            );

            mods.index.GLOBAL_ELEMENT_MAP.set(id, instance);

            geometry(
                instance.panel,
                json,
                vars,
                parent,
                mods,
                [220, 120]
            );

            instance.panel.dataset.ragImportedType =
                type || "panel";

            instance.bindings = bindingsString(json);
        }

        universalState.rawById.set(
            instance.getMainHTMLElement().dataset.id,
            rawValue
        );

        let controls = Array.isArray(json.controls)
            ? json.controls
            : [];

        // Generic Bedrock buttons have default/hover/pressed visual states.
        // Preview only default + non-state controls, otherwise all three render
        // on top of each other and make the editor look corrupted.
        if (type === "button") {
            const defaultName =
                resolveVariable(
                    json.default_control,
                    vars
                ) || "default";

            const hiddenStates = new Set([
                String(
                    resolveVariable(
                        json.hover_control,
                        vars
                    ) || "hover"
                ),
                String(
                    resolveVariable(
                        json.pressed_control,
                        vars
                    ) || "pressed"
                ),
            ]);

            controls = controls.filter((entry) => {
                const key =
                    Object.keys(entry || {})[0] || "";

                if (key === defaultName) return true;
                return !hiddenStates.has(key);
            });
        }

        const children = [];

        for (const entry of controls) {
            if (!entry || typeof entry !== "object") continue;

            for (const [key, value] of Object.entries(entry)) {
                const nextStack = new Set(stack);
                if (ref) nextStack.add(ref);

                const child = await createExternalControl(
                    instance,
                    key,
                    value,
                    vars,
                    nextStack,
                    mods
                );

                if (child) children.push(child);
            }
        }

        // Approximate stack_panel behavior.
        if (type === "stack_panel" && children.length) {
            const orientation =
                String(
                    resolveVariable(
                        json.orientation,
                        vars
                    ) || "vertical"
                ).toLowerCase();

            let cursor = 0;

            for (const child of children) {
                const el = child.getMainHTMLElement();
                const rect = el.getBoundingClientRect();

                if (orientation === "horizontal") {
                    el.style.left = `${cursor}px`;
                    el.style.top = "0px";
                    cursor += rect.width;
                } else {
                    el.style.left = "0px";
                    el.style.top = `${cursor}px`;
                    cursor += rect.height;
                }
            }
        }

        return instance;
    }

    function rootScore(key, value, namespace) {
        if (!value || typeof value !== "object") return -999;
        if (key === "namespace" || key === "config") return -999;

        let score = 0;
        const lower = key.toLowerCase();

        if (key === namespace) score += 100;
        if (Array.isArray(value.controls)) score += 50;
        if (typeof value.type === "string") score += 25;
        if (/(screen|root|main|form|wardrobe|dialog)/.test(lower)) {
            score += 20;
        }

        return score;
    }

    function discoverRoots(parsed, namespace) {
        return Object.keys(parsed)
            .filter(
                (key) =>
                    rootScore(
                        key,
                        parsed[key],
                        namespace
                    ) > -999
            )
            .sort(
                (a, b) =>
                    rootScore(
                        b,
                        parsed[b],
                        namespace
                    ) -
                    rootScore(
                        a,
                        parsed[a],
                        namespace
                    )
            );
    }

    async function renderExternalRoot(key) {
        const mods = await loadModules();

        mods.index.Builder.reset();
        mods.config.nameSpace = universalState.namespace;
        universalState.root = key;
        universalState.rawById.clear();

        const rootElement = mods.config.rootElement;
        const rootClass =
            mods.index.GLOBAL_ELEMENT_MAP.get(
                rootElement.dataset.id
            );

        if (!rootClass) {
            throw new Error(
                "Root interno do editor nao encontrado."
            );
        }

        const json = universalState.parsed[key];
        const vars = variables(json);

        if (
            json?.type !== undefined ||
            json?.texture !== undefined ||
            json?.text !== undefined
        ) {
            await createExternalControl(
                rootClass,
                key,
                json,
                vars,
                new Set([
                    `${universalState.namespace}.${key}`,
                ]),
                mods
            );
        } else {
            for (const entry of json?.controls || []) {
                for (const [name, value] of Object.entries(entry)) {
                    await createExternalControl(
                        rootClass,
                        name,
                        value,
                        vars,
                        new Set([
                            `${universalState.namespace}.${key}`,
                        ]),
                        mods
                    );
                }
            }
        }

        mods.index.Builder.updateExplorer();
        updateRootSelector();
        updatePropertyExtras();
    }

    function updateRootSelector() {
        const host =
            document.querySelector(".utilElements");

        if (!host) return;

        let box = host.querySelector(".rag-root-box");

        if (!universalState.parsed ||
            universalState.roots.length <= 1) {
            box?.remove();
            return;
        }

        if (!box) {
            box = document.createElement("div");
            box.className = "rag-root-box";
            host.appendChild(box);
        }

        box.innerHTML = "";

        const title = document.createElement("div");
        title.textContent = "JSON ROOT";

        const select = document.createElement("select");

        for (const key of universalState.roots) {
            const option = document.createElement("option");
            option.value = key;
            option.textContent = key;
            option.selected =
                key === universalState.root;
            select.appendChild(option);
        }

        select.addEventListener("change", async () => {
            select.disabled = true;

            try {
                await renderExternalRoot(select.value);
            } finally {
                select.disabled = false;
            }
        });

        box.append(title, select);
    }

    async function importExternal(parsed, fileName) {
        const mods = await loadModules();

        universalState.parsed = parsed;
        universalState.namespace =
            sanitizeNamespace(
                parsed.namespace ||
                String(fileName || "imported")
                    .replace(/\.[^.]+$/, "")
            );

        parsed.namespace =
            parsed.namespace || universalState.namespace;

        universalState.roots =
            discoverRoots(
                parsed,
                universalState.namespace
            );

        if (!universalState.roots.length) {
            throw new Error(
                "Nenhuma definicao de UI encontrada no JSON."
            );
        }

        await renderExternalRoot(
            universalState.roots[0]
        );
    }

    async function importHybrid(raw, fileName) {
        const mods = await loadModules();
        const parsed = parseJsonc(raw);

        if (!parsed || typeof parsed !== "object") {
            throw new Error("JSON invalido.");
        }

        await prepareTextures(parsed);

        if (isNativeEditorJson(parsed)) {
            universalState.parsed = null;
            universalState.roots = [];
            universalState.root = "";
            updateRootSelector();

            mods.FormUploader.uploadForm(raw);

            showBanner(
                `Modo COMPATIVEL • ${fileName}`,
                "success"
            );
        } else {
            await importExternal(parsed, fileName);

            showBanner(
                `Modo UNIVERSAL • root: ${universalState.root}`,
                "success"
            );
        }
    }

    function showBanner(text, kind = "normal") {
        let banner =
            document.querySelector(".rag-status-banner");

        if (!banner) {
            banner = document.createElement("div");
            banner.className = "rag-status-banner";
            document.body.appendChild(banner);
        }

        banner.textContent = text;
        banner.dataset.kind = kind;
        banner.classList.add("show");

        clearTimeout(showBanner.timer);
        showBanner.timer = setTimeout(
            () => banner.classList.remove("show"),
            kind === "error" ? 6000 : 3200
        );
    }

    async function installHybridUpload() {
        const mods = await loadModules();
        const input =
            document.getElementById("form_importer");

        if (!input || input.dataset.ragV11Upload === "true") {
            return;
        }

        input.dataset.ragV11Upload = "true";
        input.removeAttribute("onchange");
        input.onchange = null;

        const run = () => {
            const file = input.files?.[0];
            if (!file) return;

            const reader = new FileReader();

            showBanner(`Abrindo ${file.name}...`);

            reader.onload = async () => {
                try {
                    await importHybrid(
                        String(reader.result || ""),
                        file.name
                    );
                } catch (error) {
                    console.error(error);

                    showBanner(
                        `Falha ao abrir JSON: ${error?.message || error}`,
                        "error"
                    );
                } finally {
                    input.value = "";
                }
            };

            reader.readAsText(file);
        };

        input.addEventListener(
            "change",
            (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                run();
            },
            true
        );

        window.Builder.uploadForm = run;

        const label = input.closest("label");

        if (label && !label.querySelector(".rag-auto-badge")) {
            const badge = document.createElement("span");
            badge.className = "rag-auto-badge";
            badge.textContent = " AUTO";
            label.appendChild(badge);
        }
    }

    // ============================================================
    // Panel clipping
    // ============================================================

    function selectedContainerInstance(mods) {
        const selected = mods.index.selectedElement;
        const id = selected?.dataset?.id;

        if (!id) return null;

        const instance =
            mods.index.GLOBAL_ELEMENT_MAP.get(id);

        if (
            instance instanceof mods.DraggablePanel ||
            instance instanceof mods.DraggableCollectionPanel
        ) {
            return instance;
        }

        return null;
    }

    function panelMainElement(instance) {
        return instance?.getMainHTMLElement?.() || null;
    }

    function setPanelClipping(instance, enabled) {
        const element = panelMainElement(instance);
        if (!element) return;

        element.dataset.ragClipsChildren = String(enabled);
        element.style.overflow =
            enabled ? "hidden" : "visible";
    }

    function patchClipsChildrenExport(mods) {
        if (mods.classToJsonUI.__ragClipsPatched) return;
        mods.classToJsonUI.__ragClipsPatched = true;

        for (const className of [
            "draggable-panel",
            "draggable-collection_panel",
        ]) {
            const original =
                mods.classToJsonUI.get(className);

            if (!original) continue;

            mods.classToJsonUI.set(
                className,
                (element, namespace) => {
                    const result =
                        original(
                            element,
                            namespace
                        );

                    if (
                        result?.element &&
                        element.dataset.ragClipsChildren === "true"
                    ) {
                        result.element.clips_children = true;
                        result.element.allow_clipping = true;
                    }

                    return result;
                }
            );
        }
    }

    // ============================================================
    // EDITABLE HEADERS V19
    // A header is a REAL child panel with independent drag/resize.
    // It may contain images, labels, buttons and other children.
    // ============================================================

    let headerResizeObserver = null;

    function patchNestedPanelDrag(mods) {
        const Panel =
            mods.DraggablePanel;

        if (
            Panel.prototype
                .__ragNestedDragV19
        ) {
            return;
        }

        Panel.prototype
            .__ragNestedDragV19 = true;

        const originalStartDrag =
            Panel.prototype.startDrag;

        Panel.prototype.startDrag =
            function (event) {
                const target =
                    event.target;

                if (
                    target instanceof Element
                ) {
                    const owner =
                        target.closest(
                            "[data-id]"
                        );

                    // If this click belongs to a nested child,
                    // the parent panel must NOT start dragging.
                    if (
                        owner &&
                        owner !== this.panel &&
                        this.panel.contains(
                            owner
                        )
                    ) {
                        event.stopPropagation();
                        return;
                    }
                }

                return originalStartDrag.call(
                    this,
                    event
                );
            };
    }

    function makeHeaderDefaultImage() {
        const canvas =
            document.createElement(
                "canvas"
            );

        canvas.width = 64;
        canvas.height = 16;

        const ctx =
            canvas.getContext(
                "2d",
                {
                    willReadFrequently: true,
                }
            );

        const gradient =
            ctx.createLinearGradient(
                0,
                0,
                64,
                16
            );

        gradient.addColorStop(
            0,
            "#4b126d"
        );

        gradient.addColorStop(
            0.5,
            "#7b1fa2"
        );

        gradient.addColorStop(
            1,
            "#4b126d"
        );

        ctx.fillStyle = gradient;
        ctx.fillRect(
            0,
            0,
            64,
            16
        );

        ctx.fillStyle =
            "rgba(255,255,255,.16)";

        ctx.fillRect(
            0,
            0,
            64,
            2
        );

        ctx.fillStyle =
            "rgba(0,0,0,.35)";

        ctx.fillRect(
            0,
            14,
            64,
            2
        );

        return ctx.getImageData(
            0,
            0,
            64,
            16
        );
    }

    function ensureHeaderDefaultTexture(
        mods
    ) {
        const path =
            "rag_generated/header_default";

        if (
            mods.index.images.get(path)
                ?.png
        ) {
            return path;
        }

        const png =
            makeHeaderDefaultImage();

        mods.index.images.set(
            path,
            {
                png,
                __ragHeaderDefault: true,
            }
        );

        try {
            localStorage.setItem(
                `asset_${path}_png`,
                JSON.stringify({
                    base64:
                        imageDataToDataUrl(
                            png
                        ),
                    metadata: {
                        relativePath:
                            `textures/${path}.png`,
                        generatedHeader: true,
                    },
                })
            );
        } catch (_) {}

        return path;
    }

    function isHeaderInstance(
        instance
    ) {
        return (
            instance instanceof
                (window.__RAG_DUMMY_CLASS__ || Object) &&
            false
        );
    }

    function headerMainElement(
        instance
    ) {
        const element =
            instance?.getMainHTMLElement?.();

        if (
            element?.dataset
                ?.ragHeader === "true"
        ) {
            return element;
        }

        return null;
    }

    function headerBackgroundElement(
        header
    ) {
        const host =
            headerMainElement(
                header
            );

        if (!host) return null;

        return [
            ...host.children,
        ].find(
            (child) =>
                child instanceof
                    HTMLElement &&
                child.dataset
                    ?.ragHeaderBackground ===
                    "true"
        ) || null;
    }

    function headerBackgroundInstance(
        header,
        mods
    ) {
        const element =
            headerBackgroundElement(
                header
            );

        if (!element) return null;

        return mods.index
            .GLOBAL_ELEMENT_MAP
            .get(
                element.dataset.id
            ) || null;
    }

    function syncHeaderBackground(
        header,
        mods
    ) {
        const host =
            headerMainElement(
                header
            );

        if (!host) return;

        const bg =
            headerBackgroundInstance(
                header,
                mods
            );

        if (!bg) return;

        const rect =
            host.getBoundingClientRect();

        const width =
            parseFloat(
                host.style.width
            ) ||
            rect.width ||
            1;

        const height =
            parseFloat(
                host.style.height
            ) ||
            rect.height ||
            1;

        bg.nineSlice =
            undefined;

        bg.canvasHolder.style.left =
            "0px";

        bg.canvasHolder.style.top =
            "0px";

        bg.canvasHolder.style.zIndex =
            "0";

        bg.canvasHolder.style
            .pointerEvents = "none";

        bg.canvasHolder.dataset
            .ragKeepAspect = "false";

        bg.drawImage(
            width,
            height,
            false
        );
    }

    function ensureHeaderResizeObserver(
        mods
    ) {
        if (
            headerResizeObserver ||
            !window.ResizeObserver
        ) {
            return;
        }

        headerResizeObserver =
            new ResizeObserver(
                (entries) => {
                    for (
                        const entry
                        of entries
                    ) {
                        const host =
                            entry.target;

                        if (
                            !(host instanceof
                                HTMLElement) ||
                            host.dataset
                                .ragHeader !==
                                "true"
                        ) {
                            continue;
                        }

                        const header =
                            mods.index
                                .GLOBAL_ELEMENT_MAP
                                .get(
                                    host.dataset.id
                                );

                        if (header) {
                            syncHeaderBackground(
                                header,
                                mods
                            );
                        }
                    }
                }
            );
    }

    function installHeaderGrip(
        header
    ) {
        const host =
            headerMainElement(
                header
            );

        if (
            !host ||
            host.querySelector(
                ":scope > .rag-header-grip"
            )
        ) {
            return;
        }

        const grip =
            document.createElement(
                "div"
            );

        grip.className =
            "rag-header-grip";

        grip.dataset.skip =
            "true";

        grip.textContent =
            "HEADER";

        grip.addEventListener(
            "mousedown",
            (event) => {
                event.stopPropagation();
                header.startDrag(
                    event
                );
            }
        );

        grip.addEventListener(
            "dblclick",
            (event) => {
                event.stopPropagation();
                header.select(
                    event
                );
            }
        );

        host.appendChild(
            grip
        );
    }

    async function createEditableHeader(
        parentPanel,
        mods
    ) {
        const parent =
            panelMainElement(
                parentPanel
            );

        if (!parent) return null;

        const parentRect =
            parent.getBoundingClientRect();

        const id =
            crypto.randomUUID?.()
                ?.replace(/-/g, "")
                .slice(0, 15) ||
            Math.random()
                .toString(36)
                .slice(2, 17);

        const header =
            new mods.DraggablePanel(
                id,
                parent,
                true
            );

        mods.index
            .GLOBAL_ELEMENT_MAP
            .set(
                id,
                header
            );

        const host =
            header.panel;

        host.dataset.ragHeader =
            "true";

        host.classList.add(
            "rag-header-panel"
        );

        host.style.width =
            `${Math.max(
                120,
                parentRect.width * 0.82
            )}px`;

        host.style.height =
            `${Math.max(
                38,
                Math.min(
                    90,
                    parentRect.height *
                        0.14
                )
            )}px`;

        host.style.left =
            `${Math.max(
                0,
                (
                    parentRect.width -
                    parseFloat(
                        host.style.width
                    )
                ) / 2
            )}px`;

        host.style.top =
            "10px";

        host.style.backgroundColor =
            "rgba(100,35,135,.10)";

        const texturePath =
            ensureHeaderDefaultTexture(
                mods
            );

        const state =
            mods.index.images.get(
                texturePath
            );

        const bgId =
            crypto.randomUUID?.()
                ?.replace(/-/g, "")
                .slice(0, 15) ||
            Math.random()
                .toString(36)
                .slice(2, 17);

        const background =
            new mods.DraggableCanvas(
                bgId,
                host,
                state.png,
                texturePath,
                undefined
            );

        mods.index
            .GLOBAL_ELEMENT_MAP
            .set(
                bgId,
                background
            );

        background.canvasHolder
            .dataset
            .ragHeaderBackground =
            "true";

        background.canvasHolder
            .dataset
            .ragKeepAspect =
            "false";

        background.canvasHolder
            .style.pointerEvents =
            "none";

        background.resizeHandle
            .style.display =
            "none";

        installHeaderGrip(
            header
        );

        ensureHeaderResizeObserver(
            mods
        );

        headerResizeObserver?.observe(
            host
        );

        syncHeaderBackground(
            header,
            mods
        );

        mods.index.Builder
            .updateExplorer();

        // Select header immediately.
        header.select(
            new MouseEvent(
                "dblclick",
                {
                    bubbles: true,
                    cancelable: true,
                    clientX:
                        host.getBoundingClientRect()
                            .left + 5,
                    clientY:
                        host.getBoundingClientRect()
                            .top + 5,
                }
            )
        );

        return header;
    }

    async function changeHeaderBackground(
        header,
        mods
    ) {
        const background =
            headerBackgroundInstance(
                header,
                mods
            );

        if (!background) return;

        let path;

        try {
            path =
                await mods
                    .chooseImageModal();
        } catch (_) {
            return;
        }

        if (!path) return;

        const state =
            await ensureTexture(
                path
            );

        if (!state?.png) {
            showBanner(
                "Textura do header nao encontrada.",
                "error"
            );
            return;
        }

        // Sidecars are ignored in V19.
        const savedJson =
            state.json;

        state.json = undefined;

        try {
            background.changeImage(
                path
            );
        } finally {
            state.json = savedJson;
        }

        background.nineSlice =
            undefined;

        syncHeaderBackground(
            header,
            mods
        );

        mods.updatePropertiesArea();
    }

    function selectHeaderBackground(
        header,
        mods
    ) {
        const background =
            headerBackgroundInstance(
                header,
                mods
            );

        if (!background) return;

        background.select(
            new MouseEvent(
                "dblclick",
                {
                    bubbles: true,
                    cancelable: true,
                }
            )
        );
    }

    function centerHeader(
        header
    ) {
        const host =
            headerMainElement(
                header
            );

        if (!host) return;

        const parent =
            header.container;

        const parentRect =
            parent.getBoundingClientRect();

        const rect =
            host.getBoundingClientRect();

        host.style.left =
            `${Math.max(
                0,
                (
                    parentRect.width -
                    rect.width
                ) / 2
            )}px`;
    }

    function dockHeaderTop(
        header
    ) {
        const host =
            headerMainElement(
                header
            );

        if (!host) return;

        host.style.top =
            "0px";
    }

    function deleteHeader(
        header,
        mods
    ) {
        const host =
            headerMainElement(
                header
            );

        if (!host) return;

        headerResizeObserver?.unobserve(
            host
        );

        const descendants =
            host.querySelectorAll(
                "[data-id]"
            );

        for (
            const element
            of descendants
        ) {
            mods.index
                .GLOBAL_ELEMENT_MAP
                .delete(
                    element.dataset.id
                );
        }

        mods.index
            .GLOBAL_ELEMENT_MAP
            .delete(
                host.dataset.id
            );

        try {
            header.delete();
        } catch (_) {
            host.remove();
        }

        mods.index.Builder
            .updateExplorer();
    }

    function selectedHeaderInstance(
        mods
    ) {
        const selected =
            mods.index.selectedElement;

        const id =
            selected?.dataset?.id;

        if (!id) return null;

        const instance =
            mods.index
                .GLOBAL_ELEMENT_MAP
                .get(id);

        return headerMainElement(
            instance
        )
            ? instance
            : null;
    }

    function headerParentFromBackground(
        canvasInstance,
        mods
    ) {
        if (
            canvasInstance
                ?.canvasHolder
                ?.dataset
                ?.ragHeaderBackground !==
            "true"
        ) {
            return null;
        }

        const parent =
            canvasInstance.container;

        const id =
            parent?.dataset?.id;

        if (!id) return null;

        const header =
            mods.index
                .GLOBAL_ELEMENT_MAP
                .get(id);

        return headerMainElement(
            header
        )
            ? header
            : null;
    }

    // ============================================================
    // TEXTURE CROP / EXTRACT EDITOR V17
    // Select any rectangular region from an imported texture and either:
    // - replace the current image pixels while preserving its box, or
    // - create a new image child inside a chosen panel.
    // ============================================================

    const cropSourceCache = new Map();

    function rememberCropSource(instance) {
        const id =
            instance.canvasHolder.dataset.id;

        const path =
            normalizeTexture(
                instance.canvasHolder.dataset.imagePath
            );

        const cached =
            cropSourceCache.get(id);

        if (
            cached &&
            cached.currentPath === path
        ) {
            return cached;
        }

        const source = {
            currentPath: path,
            imageData:
                cloneImageData(
                    instance.imageData
                ),
            originalNineSlice:
                instance.nineSlice
                    ? structuredClone(
                        instance.nineSlice
                    )
                    : undefined,
        };

        cropSourceCache.set(
            id,
            source
        );

        return source;
    }

    function panelInstances(mods) {
        const panels = [];

        for (
            const [id, instance]
            of mods.index.GLOBAL_ELEMENT_MAP.entries()
        ) {
            if (
                instance instanceof mods.DraggablePanel ||
                instance instanceof mods.DraggableCollectionPanel
            ) {
                const el =
                    instance.getMainHTMLElement();

                // Skip the editor's hidden root wrapper as a destination.
                if (
                    el.dataset.id ===
                    mods.config.rootElement?.dataset.id
                ) {
                    continue;
                }

                panels.push({
                    id,
                    instance,
                    element: el,
                });
            }
        }

        return panels;
    }

    function panelDisplayName(
        panelInfo,
        index
    ) {
        const el =
            panelInfo.element;

        const importedType =
            el.dataset.ragImportedType;

        const collection =
            el.dataset.collectionName;

        if (collection) {
            return `Collection: ${collection} (${index + 1})`;
        }

        if (importedType) {
            return `${importedType} (${index + 1})`;
        }

        return `Panel ${index + 1}`;
    }

    function nearestParentPanelInfo(
        instance,
        mods
    ) {
        let current =
            instance.container;

        while (
            current &&
            current.id !== "main_window"
        ) {
            const id =
                current.dataset?.id;

            if (id) {
                const candidate =
                    mods.index.GLOBAL_ELEMENT_MAP.get(
                        id
                    );

                if (
                    candidate instanceof mods.DraggablePanel ||
                    candidate instanceof mods.DraggableCollectionPanel
                ) {
                    return {
                        id,
                        instance: candidate,
                        element: current,
                    };
                }
            }

            current =
                current.parentElement;
        }

        return null;
    }

    async function createCropTextureState(
        sourceInfo,
        rect,
        basePath,
        mods
    ) {
        const cropped =
            cropImageData(
                sourceInfo.imageData,
                rect.l,
                rect.t,
                rect.r,
                rect.b
            );

        let stem =
            cleanImageName(
                basePath
                    .split("/")
                    .pop() || "crop"
            );

        let path =
            `gallery/${stem}_crop`;

        let suffix = 2;

        while (
            mods.index.images.has(path)
        ) {
            path =
                `gallery/${stem}_crop_${suffix++}`;
        }

        const state = {
            png: cropped,
            __ragCroppedTexture: true,
            __ragCropSource: basePath,
        };

        mods.index.images.set(
            path,
            state
        );

        try {
            localStorage.setItem(
                `asset_${path}_png`,
                JSON.stringify({
                    base64:
                        imageDataToDataUrl(
                            cropped
                        ),
                    metadata: {
                        relativePath:
                            `textures/${path}.png`,
                        croppedFrom:
                            basePath,
                        generatedCrop: true,
                    },
                })
            );
        } catch (_) {}

        return {
            path,
            state,
            cropped,
        };
    }

    async function replaceImageWithCrop(
        instance,
        sourceInfo,
        rect,
        mods
    ) {
        const box =
            currentBox(instance);

        const basePath =
            normalizeTexture(
                sourceInfo.currentPath ||
                instance.canvasHolder.dataset.imagePath
            );

        const result =
            await createCropTextureState(
                sourceInfo,
                rect,
                basePath,
                mods
            );

        instance.imageData =
            result.cropped;

        instance.nineSlice =
            undefined;

        instance.canvasHolder.dataset.imagePath =
            result.path;

        instance.canvasHolder.dataset.ragKeepAspect =
            "false";

        instance.canvasHolder.dataset.ragCrop =
            "true";

        instance.drawImage(
            box.width,
            box.height,
            false
        );

        instance.canvasHolder.style.left =
            box.left;

        instance.canvasHolder.style.top =
            box.top;

        instance.canvasHolder.style.zIndex =
            box.layer;

        mods.updatePropertiesArea();
        mods.index.Builder.updateExplorer();

        return result.path;
    }

    async function createCropInPanel(
        sourceInfo,
        rect,
        destinationPanel,
        sourceInstance,
        mods
    ) {
        const basePath =
            normalizeTexture(
                sourceInfo.currentPath ||
                sourceInstance.canvasHolder.dataset.imagePath
            );

        const result =
            await createCropTextureState(
                sourceInfo,
                rect,
                basePath,
                mods
            );

        const parent =
            destinationPanel.getMainHTMLElement();

        const id =
            crypto.randomUUID?.()
                ?.replace(/-/g, "")
                .slice(0, 15) ||
            Math.random()
                .toString(36)
                .slice(2, 17);

        const image =
            new mods.DraggableCanvas(
                id,
                parent,
                result.cropped,
                result.path
            );

        mods.index.GLOBAL_ELEMENT_MAP.set(
            id,
            image
        );

        const parentRect =
            parent.getBoundingClientRect();

        // Initial size = source crop at editor scale, capped to fit.
        const maxW =
            Math.max(
                20,
                parentRect.width * 0.8
            );

        const maxH =
            Math.max(
                20,
                parentRect.height * 0.8
            );

        const cropRatio =
            result.cropped.width /
            Math.max(
                1,
                result.cropped.height
            );

        let width =
            Math.min(
                result.cropped.width,
                maxW
            );

        let height =
            width / cropRatio;

        if (height > maxH) {
            height = maxH;
            width =
                height * cropRatio;
        }

        image.drawImage(
            width,
            height,
            false
        );

        image.canvasHolder.style.left =
            `${Math.max(
                0,
                (parentRect.width - width) / 2
            )}px`;

        image.canvasHolder.style.top =
            `${Math.max(
                0,
                (parentRect.height - height) / 2
            )}px`;

        image.canvasHolder.dataset.ragKeepAspect =
            "true";

        image.aspectRatio =
            cropRatio;

        mods.index.Builder.updateExplorer();

        return image;
    }

    async function openTextureCropEditor(
        instance,
        mods
    ) {
        document
            .getElementById(
                "ragTextureCropEditor"
            )
            ?.remove();

        const sourceInfo =
            rememberCropSource(instance);

        const source =
            sourceInfo.imageData;

        if (
            source.width < 2 ||
            source.height < 2
        ) {
            showBanner(
                "A textura e pequena demais para recortar.",
                "error"
            );

            return;
        }

        const rect = {
            l: 0,
            t: 0,
            r: source.width,
            b: source.height,
        };

        const overlay =
            document.createElement("div");

        overlay.id =
            "ragTextureCropEditor";

        overlay.className =
            "rag-crop-overlay";

        const card =
            document.createElement("div");

        card.className =
            "rag-crop-card";

        const title =
            document.createElement("div");

        title.className =
            "rag-crop-title";

        title.textContent =
            "RECORTAR / EXTRAIR TEXTURA";

        const hint =
            document.createElement("div");

        hint.className =
            "rag-crop-hint";

        hint.textContent =
            `Arraste os 4 cantos. Fonte: textures/${sourceInfo.currentPath}`;

        const stage =
            document.createElement("div");

        stage.className =
            "rag-crop-stage";

        const canvas =
            document.createElement("canvas");

        canvas.width =
            source.width;

        canvas.height =
            source.height;

        canvas.className =
            "rag-crop-source";

        canvas
            .getContext("2d")
            .putImageData(
                source,
                0,
                0
            );

        stage.appendChild(canvas);

        const selection =
            document.createElement("div");

        selection.className =
            "rag-crop-selection";

        makeRectHandles(
            selection,
            "crop"
        );

        stage.appendChild(
            selection
        );

        const readout =
            document.createElement("div");

        readout.className =
            "rag-crop-readout";

        const destinationRow =
            document.createElement("div");

        destinationRow.className =
            "rag-crop-destination";

        const destinationLabel =
            document.createElement("label");

        destinationLabel.textContent =
            "Painel de destino:";

        const destination =
            document.createElement("select");

        const panels =
            panelInstances(mods);

        const nearest =
            nearestParentPanelInfo(
                instance,
                mods
            );

        panels.forEach(
            (panel, index) => {
                const option =
                    document.createElement(
                        "option"
                    );

                option.value =
                    panel.id;

                option.textContent =
                    panelDisplayName(
                        panel,
                        index
                    );

                if (
                    nearest &&
                    panel.id === nearest.id
                ) {
                    option.selected = true;
                }

                destination.appendChild(
                    option
                );
            }
        );

        destinationRow.append(
            destinationLabel,
            destination
        );

        const actions =
            document.createElement("div");

        actions.className =
            "rag-crop-actions";

        const cancel =
            document.createElement("button");

        cancel.type = "button";
        cancel.textContent =
            "CANCELAR";

        const replace =
            document.createElement("button");

        replace.type = "button";
        replace.textContent =
            "SUBSTITUIR ESTA IMAGEM";

        const create =
            document.createElement("button");

        create.type = "button";
        create.className = "primary";
        create.textContent =
            "CRIAR RECORTE NO PAINEL";

        actions.append(
            cancel,
            replace,
            create
        );

        card.append(
            title,
            hint,
            stage,
            readout,
            destinationRow,
            actions
        );

        overlay.appendChild(card);
        document.body.appendChild(
            overlay
        );

        function fitStage() {
            const maxWidth =
                Math.min(
                    window.innerWidth - 50,
                    760
                );

            const maxHeight =
                Math.min(
                    window.innerHeight - 330,
                    540
                );

            const scale =
                Math.max(
                    0.15,
                    Math.min(
                        maxWidth / source.width,
                        maxHeight / source.height,
                        12
                    )
                );

            const cssWidth =
                Math.max(
                    120,
                    Math.round(
                        source.width * scale
                    )
                );

            const cssHeight =
                Math.max(
                    80,
                    Math.round(
                        source.height * scale
                    )
                );

            stage.style.width =
                `${cssWidth}px`;

            stage.style.height =
                `${cssHeight}px`;

            canvas.style.width =
                `${cssWidth}px`;

            canvas.style.height =
                `${cssHeight}px`;

            return {
                scaleX:
                    cssWidth /
                    source.width,
                scaleY:
                    cssHeight /
                    source.height,
            };
        }

        let scale =
            fitStage();

        function constrainCrop() {
            rect.l =
                clampNumber(
                    Math.round(rect.l),
                    0,
                    Math.max(
                        0,
                        rect.r - 1
                    )
                );

            rect.t =
                clampNumber(
                    Math.round(rect.t),
                    0,
                    Math.max(
                        0,
                        rect.b - 1
                    )
                );

            rect.r =
                clampNumber(
                    Math.round(rect.r),
                    Math.min(
                        source.width,
                        rect.l + 1
                    ),
                    source.width
                );

            rect.b =
                clampNumber(
                    Math.round(rect.b),
                    Math.min(
                        source.height,
                        rect.t + 1
                    ),
                    source.height
                );
        }

        function render() {
            scale =
                fitStage();

            positionRectElement(
                selection,
                rect,
                scale.scaleX,
                scale.scaleY
            );

            readout.textContent =
                `AREA ${rectWidth(rect)} × ${rectHeight(rect)} px  •  ` +
                `x:${rect.l} y:${rect.t}`;
        }

        render();

        let drag = null;

        stage.addEventListener(
            "pointerdown",
            (event) => {
                const target =
                    event.target;

                if (
                    !(target instanceof HTMLElement) ||
                    !target.classList.contains(
                        "rag-crop-handle"
                    )
                ) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();

                drag = {
                    id:
                        event.pointerId,
                    corner:
                        target.dataset.corner,
                };

                try {
                    target.setPointerCapture(
                        event.pointerId
                    );
                } catch (_) {}
            },
            {
                passive: false,
            }
        );

        stage.addEventListener(
            "pointermove",
            (event) => {
                if (
                    !drag ||
                    drag.id !==
                        event.pointerId
                ) {
                    return;
                }

                event.preventDefault();

                const bounds =
                    stage.getBoundingClientRect();

                const x =
                    clampNumber(
                        (event.clientX -
                            bounds.left) /
                            scale.scaleX,
                        0,
                        source.width
                    );

                const y =
                    clampNumber(
                        (event.clientY -
                            bounds.top) /
                            scale.scaleY,
                        0,
                        source.height
                    );

                if (
                    drag.corner.includes("l")
                ) {
                    rect.l = x;
                }

                if (
                    drag.corner.includes("r")
                ) {
                    rect.r = x;
                }

                if (
                    drag.corner.includes("t")
                ) {
                    rect.t = y;
                }

                if (
                    drag.corner.includes("b")
                ) {
                    rect.b = y;
                }

                constrainCrop();
                render();
            },
            {
                passive: false,
            }
        );

        const stopDrag =
            (event) => {
                if (
                    drag &&
                    drag.id ===
                        event.pointerId
                ) {
                    drag = null;
                }
            };

        stage.addEventListener(
            "pointerup",
            stopDrag
        );

        stage.addEventListener(
            "pointercancel",
            stopDrag
        );

        window.addEventListener(
            "resize",
            render
        );

        const close = () => {
            window.removeEventListener(
                "resize",
                render
            );

            overlay.remove();
        };

        cancel.addEventListener(
            "click",
            close
        );

        replace.addEventListener(
            "click",
            async () => {
                replace.disabled = true;
                create.disabled = true;

                try {
                    const path =
                        await replaceImageWithCrop(
                            instance,
                            sourceInfo,
                            rect,
                            mods
                        );

                    close();

                    showBanner(
                        `Imagem recortada: textures/${path}`,
                        "success"
                    );
                } catch (error) {
                    console.error(error);

                    showBanner(
                        `Falha ao recortar: ${error?.message || error}`,
                        "error"
                    );
                } finally {
                    replace.disabled = false;
                    create.disabled = false;
                }
            }
        );

        create.addEventListener(
            "click",
            async () => {
                const panel =
                    mods.index.GLOBAL_ELEMENT_MAP.get(
                        destination.value
                    );

                if (!panel) {
                    showBanner(
                        "Selecione um painel de destino.",
                        "error"
                    );
                    return;
                }

                create.disabled = true;
                replace.disabled = true;

                try {
                    const newImage =
                        await createCropInPanel(
                            sourceInfo,
                            rect,
                            panel,
                            instance,
                            mods
                        );

                    close();

                    // Select the newly-created image immediately so the user
                    // can drag/resize it without hunting through Explorer.
                    const el =
                        newImage.getMainHTMLElement();

                    const bounds =
                        el.getBoundingClientRect();

                    newImage.select(
                        new MouseEvent(
                            "dblclick",
                            {
                                bubbles: true,
                                cancelable: true,
                                clientX:
                                    bounds.left +
                                    bounds.width / 2,
                                clientY:
                                    bounds.top +
                                    bounds.height / 2,
                            }
                        )
                    );

                    showBanner(
                        "Recorte criado dentro do painel.",
                        "success"
                    );
                } catch (error) {
                    console.error(error);

                    showBanner(
                        `Falha ao criar recorte: ${error?.message || error}`,
                        "error"
                    );
                } finally {
                    create.disabled = false;
                    replace.disabled = false;
                }
            }
        );
    }

    // ============================================================
    // Generic crop geometry helpers
    // ============================================================

    function clampNumber(value, min, max) {
        return Math.max(
            min,
            Math.min(max, value)
        );
    }

    function cloneImageData(imageData) {
        return new ImageData(
            new Uint8ClampedArray(
                imageData.data
            ),
            imageData.width,
            imageData.height,
            {
                colorSpace:
                    imageData.colorSpace ||
                    "srgb",
            }
        );
    }

    function cropImageData(
        source,
        left,
        top,
        right,
        bottom
    ) {
        left = Math.floor(left);
        top = Math.floor(top);
        right = Math.ceil(right);
        bottom = Math.ceil(bottom);

        const width =
            Math.max(
                1,
                right - left
            );

        const height =
            Math.max(
                1,
                bottom - top
            );

        const canvas =
            document.createElement(
                "canvas"
            );

        canvas.width =
            source.width;

        canvas.height =
            source.height;

        const ctx =
            canvas.getContext(
                "2d",
                {
                    willReadFrequently: true,
                }
            );

        ctx.putImageData(
            source,
            0,
            0
        );

        return ctx.getImageData(
            left,
            top,
            width,
            height
        );
    }

    function imageDataToDataUrl(
        imageData
    ) {
        const canvas =
            document.createElement(
                "canvas"
            );

        canvas.width =
            imageData.width;

        canvas.height =
            imageData.height;

        canvas
            .getContext("2d")
            .putImageData(
                imageData,
                0,
                0
            );

        return canvas.toDataURL(
            "image/png"
        );
    }

    function rectWidth(rect) {
        return Math.max(
            1,
            rect.r - rect.l
        );
    }

    function rectHeight(rect) {
        return Math.max(
            1,
            rect.b - rect.t
        );
    }

    function positionRectElement(
        element,
        rect,
        scaleX,
        scaleY
    ) {
        element.style.left =
            `${rect.l * scaleX}px`;

        element.style.top =
            `${rect.t * scaleY}px`;

        element.style.width =
            `${rectWidth(rect) * scaleX}px`;

        element.style.height =
            `${rectHeight(rect) * scaleY}px`;
    }

    function makeRectHandles(
        rectElement
    ) {
        const corners = [
            ["tl", "top-left"],
            ["tr", "top-right"],
            ["bl", "bottom-left"],
            ["br", "bottom-right"],
        ];

        for (
            const [corner, cssCorner]
            of corners
        ) {
            const handle =
                document.createElement(
                    "div"
                );

            handle.className =
                `rag-crop-handle ${cssCorner}`;

            handle.dataset.corner =
                corner;

            rectElement.appendChild(
                handle
            );
        }
    }

    // ============================================================
    // Selected image property extras
    // ============================================================

    async function selectedCanvas() {
        const mods = await loadModules();
        const selected = mods.index.selectedElement;
        const id = selected?.dataset?.id;

        if (!id) return null;

        const instance =
            mods.index.GLOBAL_ELEMENT_MAP.get(id);

        return instance instanceof mods.DraggableCanvas
            ? instance
            : null;
    }

    async function loadExactPath(instance, file) {
        const mods = await loadModules();
        const path =
            normalizeTexture(
                instance.canvasHolder.dataset.imagePath
            );

        const [png, dataUrl] = await Promise.all([
            fileImageData(file),
            fileDataUrl(file),
        ]);

        mods.index.images.set(path, { png });

        universalState.missingPaths.delete(path);

        try {
            localStorage.setItem(
                `asset_${path}_png`,
                JSON.stringify({
                    base64: dataUrl,
                    metadata: {
                        name: file.name,
                        relativePath: `textures/${path}.png`,
                    },
                })
            );
        } catch (_) {}

        instance.changeImage(path);
        instance.canvasHolder.dataset.ragFallbackActive = "false";
    }

    async function updatePropertyExtras() {
        const properties =
            document.getElementById("properties");

        if (!properties) return;

        const mods = await loadModules();
        const panelInstance = selectedContainerInstance(mods);

        const oldPanelTools =
            properties.querySelector(".rag-panel-tools");

        if (panelInstance) {
            const panelElement =
                panelMainElement(
                    panelInstance
                );

            const panelId =
                panelElement?.dataset
                    ?.id || "";

            const isHeader =
                panelElement?.dataset
                    ?.ragHeader ===
                "true";

            if (
                oldPanelTools
                    ?.dataset.id !==
                panelId
            ) {
                oldPanelTools?.remove();

                const panelBox =
                    document.createElement(
                        "div"
                    );

                panelBox.className =
                    "rag-panel-tools";

                panelBox.dataset.id =
                    panelId;

                const title =
                    document.createElement(
                        "div"
                    );

                title.className =
                    "rag-panel-tools-title";

                title.textContent =
                    isHeader
                        ? "HEADER EDITAVEL"
                        : "PAINEL";

                const clip =
                    document.createElement(
                        "button"
                    );

                clip.type = "button";
                clip.className =
                    "propertyInputButton";

                const renderClip =
                    () => {
                        const enabled =
                            panelElement
                                ?.dataset
                                .ragClipsChildren ===
                            "true";

                        clip.textContent =
                            enabled
                                ? "PRENDER FILHOS: SIM"
                                : "PRENDER FILHOS: NAO";
                    };

                renderClip();

                clip.addEventListener(
                    "click",
                    () => {
                        const enabled =
                            panelElement
                                ?.dataset
                                .ragClipsChildren ===
                            "true";

                        setPanelClipping(
                            panelInstance,
                            !enabled
                        );

                        renderClip();
                    }
                );

                panelBox.append(
                    title,
                    clip
                );

                if (isHeader) {
                    const changeBg =
                        document.createElement(
                            "button"
                        );

                    changeBg.type =
                        "button";

                    changeBg.className =
                        "propertyInputButton rag-header-primary";

                    changeBg.textContent =
                        "TROCAR FUNDO DO HEADER";

                    changeBg.addEventListener(
                        "click",
                        async () => {
                            changeBg.disabled =
                                true;

                            try {
                                await changeHeaderBackground(
                                    panelInstance,
                                    mods
                                );
                            } finally {
                                changeBg.disabled =
                                    false;
                            }
                        }
                    );

                    const selectBg =
                        document.createElement(
                            "button"
                        );

                    selectBg.type =
                        "button";

                    selectBg.className =
                        "propertyInputButton";

                    selectBg.textContent =
                        "EDITAR FUNDO COMO IMAGEM";

                    selectBg.addEventListener(
                        "click",
                        () => {
                            selectHeaderBackground(
                                panelInstance,
                                mods
                            );
                        }
                    );

                    const center =
                        document.createElement(
                            "button"
                        );

                    center.type =
                        "button";

                    center.className =
                        "propertyInputButton";

                    center.textContent =
                        "CENTRALIZAR NO PAINEL";

                    center.addEventListener(
                        "click",
                        () => {
                            centerHeader(
                                panelInstance
                            );
                        }
                    );

                    const dock =
                        document.createElement(
                            "button"
                        );

                    dock.type =
                        "button";

                    dock.className =
                        "propertyInputButton";

                    dock.textContent =
                        "ENCAIXAR NO TOPO";

                    dock.addEventListener(
                        "click",
                        () => {
                            dockHeaderTop(
                                panelInstance
                            );
                        }
                    );

                    const remove =
                        document.createElement(
                            "button"
                        );

                    remove.type =
                        "button";

                    remove.className =
                        "propertyInputButton rag-header-delete";

                    remove.textContent =
                        "REMOVER HEADER";

                    remove.addEventListener(
                        "click",
                        () => {
                            deleteHeader(
                                panelInstance,
                                mods
                            );
                        }
                    );

                    const hint =
                        document.createElement(
                            "div"
                        );

                    hint.className =
                        "rag-panel-tools-hint";

                    hint.textContent =
                        "Arraste o proprio header ou a alca HEADER. O painel pai nao se move. Com o header selecionado, Add Image / Add Label adicionam elementos dentro dele.";

                    panelBox.append(
                        changeBg,
                        selectBg,
                        center,
                        dock,
                        remove,
                        hint
                    );
                } else {
                    const createHeader =
                        document.createElement(
                            "button"
                        );

                    createHeader.type =
                        "button";

                    createHeader.className =
                        "propertyInputButton rag-header-primary";

                    createHeader.textContent =
                        "CRIAR HEADER EDITAVEL";

                    createHeader.addEventListener(
                        "click",
                        async () => {
                            createHeader.disabled =
                                true;

                            try {
                                await createEditableHeader(
                                    panelInstance,
                                    mods
                                );
                            } finally {
                                createHeader.disabled =
                                    false;
                            }
                        }
                    );

                    const hint =
                        document.createElement(
                            "div"
                        );

                    hint.className =
                        "rag-panel-tools-hint";

                    hint.textContent =
                        "O header e um painel filho real: move, redimensiona e recebe imagens/textos sem arrastar o painel pai.";

                    panelBox.append(
                        createHeader,
                        hint
                    );
                }

                properties.appendChild(
                    panelBox
                );
            }
        } else {
            oldPanelTools?.remove();
        }

        const instance = await selectedCanvas();

        const old =
            properties.querySelector(".rag-image-tools");

        if (!instance) {
            old?.remove();
            return;
        }

        const id = instance.canvasHolder.dataset.id;

        if (old?.dataset.id === id) {
            const pathLabel =
                old.querySelector(".rag-texture-path");

            if (pathLabel) {
                pathLabel.textContent =
                    `${
                        instance.canvasHolder.dataset.ragFallbackActive === "true"
                            ? "FALLBACK"
                            : "TEXTURA"
                    }: textures/${instance.canvasHolder.dataset.imagePath}`;
            }

            return;
        }

        old?.remove();

        if (
            instance.canvasHolder.dataset.ragKeepAspect === undefined
        ) {
            instance.canvasHolder.dataset.ragKeepAspect = "false";
        }

        const box = document.createElement("div");
        box.className = "rag-image-tools";
        box.dataset.id = id || "";

        const pathLabel = document.createElement("div");
        pathLabel.className = "rag-texture-path";
        pathLabel.textContent =
            `${
                instance.canvasHolder.dataset.ragFallbackActive === "true"
                    ? "FALLBACK"
                    : "TEXTURA"
            }: textures/${instance.canvasHolder.dataset.imagePath}`;

        const aspect = document.createElement("button");
        aspect.type = "button";
        aspect.className = "propertyInputButton";

        const renderAspect = () => {
            const locked =
                instance.canvasHolder.dataset.ragKeepAspect === "true";

            aspect.textContent =
                locked
                    ? "PROPORCAO: TRAVADA"
                    : "PROPORCAO: LIVRE";
        };

        renderAspect();

        aspect.addEventListener("click", () => {
            const locked =
                instance.canvasHolder.dataset.ragKeepAspect === "true";

            instance.canvasHolder.dataset.ragKeepAspect =
                String(!locked);

            const boxState = currentBox(instance);
            instance.aspectRatio = boxState.boxRatio;

            renderAspect();
        });

        const fill = document.createElement("button");
        fill.type = "button";
        fill.className = "propertyInputButton";
        fill.textContent = "PREENCHER PAINEL";

        fill.addEventListener("click", () => {
            const rect =
                instance.container.getBoundingClientRect();

            instance.canvasHolder.style.left = "0px";
            instance.canvasHolder.style.top = "0px";

            instance.drawImage(
                rect.width,
                rect.height,
                false
            );

            instance.aspectRatio =
                rect.width / Math.max(1, rect.height);

            mods.updatePropertiesArea();
        });

        const exact = document.createElement("button");
        exact.type = "button";
        exact.className = "propertyInputButton";
        exact.textContent =
            "CARREGAR NESTE CAMINHO";

        const cropTexture =
            document.createElement("button");

        cropTexture.type = "button";
        cropTexture.className =
            "propertyInputButton rag-crop-edit-button";

        cropTexture.textContent =
            "RECORTAR / EXTRAIR AREA";

        cropTexture.addEventListener(
            "click",
            async () => {
                cropTexture.disabled = true;

                try {
                    await openTextureCropEditor(
                        instance,
                        mods
                    );
                } finally {
                    cropTexture.disabled = false;
                }
            }
        );

        const file = document.createElement("input");
        file.type = "file";
        file.style.display = "none";

        exact.addEventListener("click", () => {
            file.value = "";
            file.click();
        });

        file.addEventListener("change", async () => {
            const chosen = file.files?.[0];
            if (!chosen) return;

            try {
                await loadExactPath(instance, chosen);
                mods.updatePropertiesArea();
            } catch (error) {
                showBanner(
                    `Falha na textura: ${error?.message || error}`,
                    "error"
                );
            }
        });

        box.append(
            pathLabel,
            aspect,
            fill,
            cropTexture,
            exact,
            file
        );

        const parentHeader =
            headerParentFromBackground(
                instance,
                mods
            );

        if (parentHeader) {
            const backHeader =
                document.createElement(
                    "button"
                );

            backHeader.type =
                "button";

            backHeader.className =
                "propertyInputButton rag-header-primary";

            backHeader.textContent =
                "VOLTAR AO HEADER";

            backHeader.addEventListener(
                "click",
                () => {
                    parentHeader.select(
                        new MouseEvent(
                            "dblclick",
                            {
                                bubbles: true,
                                cancelable: true,
                            }
                        )
                    );
                }
            );

            box.appendChild(
                backHeader
            );
        }

        properties.appendChild(box);
    }

    function observeProperties() {
        const properties =
            document.getElementById("properties");

        if (!properties || propertyObserver) return;

        propertyObserver = new MutationObserver(() => {
            queueMicrotask(updatePropertyExtras);
        });

        propertyObserver.observe(properties, {
            childList: true,
            subtree: false,
        });
    }

    // ============================================================
    // Styles
    // ============================================================

    function installStyles() {
        if (document.getElementById("rag-v11-style")) return;

        const style = document.createElement("style");
        style.id = "rag-v11-style";
        style.textContent = `
@media (pointer: coarse) {
    html,
    body {
        touch-action: pan-x pan-y pinch-zoom !important;
    }

    body.rag-touch-edit #main_window {
        touch-action: pinch-zoom !important;
        overscroll-behavior: contain;
    }

    body.rag-touch-nav #main_window {
        touch-action: pan-x pan-y pinch-zoom !important;
    }

    body.rag-touch-edit .resize-handle {
        width: 30px !important;
        height: 30px !important;
        left: calc(100% - 30px) !important;
        top: calc(100% - 30px) !important;
        min-width: 30px;
        min-height: 30px;
    }
}

.rag-touch-toggle {
    position: fixed;
    right: 14px;
    bottom: 14px;
    z-index: 200000;
    min-width: 145px;
    min-height: 48px;
    padding: 9px 12px;
    border: 2px solid #a542de;
    border-radius: 10px;
    background: rgba(25,25,29,.95);
    color: white;
    font: 800 12px/1.15 sans-serif;
    touch-action: manipulation;
}

.rag-touch-toggle small {
    display: block;
    margin-top: 3px;
    font-size: 9px;
    font-weight: 500;
    opacity: .72;
}

.rag-file-picker {
    margin: 10px 0 12px;
    padding: 10px;
    border: 1px solid rgba(159,54,220,.48);
    border-radius: 9px;
    background: rgba(20,20,23,.76);
}

.rag-file-picker button {
    width: 100%;
    min-height: 45px;
    margin-bottom: 7px;
    border: 1px solid #a236de;
    border-radius: 7px;
    background: linear-gradient(135deg,#5d197d,#a31564);
    color: white;
    font-weight: 800;
}

.rag-file-picker button.secondary {
    border-color: #666;
    background: #38383d;
}

.rag-file-status {
    text-align: center;
    color: #aaa;
    font-size: 10px;
}

.rag-file-status[data-kind="success"] {
    color: #8ff0a7;
}

.rag-file-status[data-kind="error"] {
    color: #ff9d9d;
}

.rag-root-box {
    margin: 8px 5px;
    padding: 7px;
    border: 1px solid #71368c;
    border-radius: 6px;
    background: #2b2b2f;
    color: #d98aff;
    font-size: 9px;
    font-weight: 800;
}

.rag-root-box select {
    width: 100%;
    min-height: 34px;
    margin-top: 4px;
    background: #202024;
    color: white;
    border: 1px solid #5e5e65;
}

.rag-status-banner {
    position: fixed;
    top: 82px;
    left: 50%;
    z-index: 300000;
    max-width: calc(100vw - 30px);
    padding: 9px 12px;
    border: 1px solid #9f42d4;
    border-radius: 8px;
    background: rgba(22,22,26,.96);
    color: white;
    font: 700 11px/1.3 sans-serif;
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, -10px);
    transition: .16s ease;
}

.rag-status-banner.show {
    opacity: 1;
    transform: translate(-50%, 0);
}

.rag-status-banner[data-kind="success"] {
    border-color: #43bd69;
}

.rag-status-banner[data-kind="error"] {
    border-color: #e24b4b;
    color: #ffadad;
}

.rag-auto-badge {
    margin-left: 4px;
    padding: 2px 4px;
    border-radius: 3px;
    background: #176632;
    color: #aaffbf;
    font-size: 7px;
    font-weight: 900;
}


.gridable.rag-grid-visible {
    --rag-grid-line: rgba(255, 0, 255, .72);
    background-image:
        linear-gradient(
            to right,
            var(--rag-grid-line) 1px,
            transparent 1px
        ),
        linear-gradient(
            to bottom,
            var(--rag-grid-line) 1px,
            transparent 1px
        ) !important;
    background-size:
        calc(100% / var(--grid-cols))
        calc(100% / var(--grid-rows)) !important;
    background-position: 0 0 !important;
    pointer-events: none !important;
    z-index: 2147482000 !important;
    opacity: .9;
}

.rag-editable-frame-button {
    background:
        linear-gradient(135deg,#292b31,#555a62)
        !important;
}

.rag-frame-thickness-label {
    display: block;
    margin: 4px 0 2px;
    color: #bbb;
    font-size: 9px;
}

.rag-frame-thickness {
    width: 84px !important;
}

.rag-frame-part-select {
    min-height: 34px;
    margin: 4px 7px 7px 0;
    padding: 5px;
    border: 1px solid #67676d;
    border-radius: 5px;
    background: #29292e;
    color: white;
}

.rag-panel-tools {
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid rgba(175,75,235,.38);
}

.rag-panel-tools-title {
    margin-bottom: 6px;
    color: #d98aff;
    font-size: 9px;
    font-weight: 900;
}

.rag-panel-tools button {
    margin-right: 6px;
    margin-bottom: 6px;
}

.rag-embedded-header-button {
    background: linear-gradient(135deg,#501278,#8327c9) !important;
}

.rag-dark-frame-button {
    background: linear-gradient(135deg,#25272b,#4a4d52) !important;
}

.rag-panel-tools-hint {
    max-width: 360px;
    color: #999;
    font-size: 9px;
    line-height: 1.35;
}

.rag-crop-edit-button {
    background:
        linear-gradient(135deg,#245179,#315f93)
        !important;
}

.rag-crop-overlay {
    position: fixed;
    inset: 0;
    z-index: 400100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 15px;
    background: rgba(0,0,0,.78);
    backdrop-filter: blur(3px);
}

.rag-crop-card {
    width: min(820px, calc(100vw - 30px));
    max-height: calc(100vh - 30px);
    overflow: auto;
    box-sizing: border-box;
    padding: 14px;
    border: 2px solid #468dd0;
    border-radius: 10px;
    background: #28282c;
    color: white;
}

.rag-crop-title {
    margin-bottom: 7px;
    text-align: center;
    font-size: 17px;
    font-weight: 900;
}

.rag-crop-hint {
    margin-bottom: 8px;
    color: #b7b7ba;
    text-align: center;
    font-size: 10px;
    overflow-wrap: anywhere;
}

.rag-crop-stage {
    position: relative;
    margin: 0 auto;
    overflow: hidden;
    border: 1px solid #777;
    background: #1b1b1e;
    touch-action: none;
}

.rag-crop-source {
    position: absolute;
    inset: 0;
    image-rendering: pixelated;
}

.rag-crop-selection {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid #4eb0ff;
    background: rgba(60,160,255,.10);
    box-shadow:
        0 0 0 9999px rgba(0,0,0,.48);
    pointer-events: none;
}

.rag-crop-handle {
    position: absolute;
    width: 24px;
    height: 24px;
    box-sizing: border-box;
    border: 2px solid #141414;
    border-radius: 50%;
    background: #4eb0ff;
    transform: translate(-50%,-50%);
    pointer-events: auto;
    touch-action: none;
}

.rag-crop-handle.top-left {
    left: 0;
    top: 0;
}

.rag-crop-handle.top-right {
    left: 100%;
    top: 0;
}

.rag-crop-handle.bottom-left {
    left: 0;
    top: 100%;
}

.rag-crop-handle.bottom-right {
    left: 100%;
    top: 100%;
}

.rag-crop-readout {
    margin-top: 8px;
    padding: 7px;
    border-radius: 5px;
    background: #19191c;
    color: #9fd1ff;
    text-align: center;
    font: 700 10px/1.3 monospace;
}

.rag-crop-destination {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 9px;
}

.rag-crop-destination label {
    flex: 0 0 auto;
    color: #bbb;
    font-size: 10px;
}

.rag-crop-destination select {
    flex: 1;
    min-height: 38px;
    border: 1px solid #666;
    border-radius: 6px;
    background: #202024;
    color: white;
}

.rag-crop-actions {
    display: flex;
    gap: 7px;
    margin-top: 10px;
}

.rag-crop-actions button {
    flex: 1;
    min-height: 44px;
    border: 1px solid #606066;
    border-radius: 6px;
    background: #3b3b40;
    color: white;
    font-weight: 900;
}

.rag-crop-actions button.primary {
    border-color: #408bc6;
    background:
        linear-gradient(135deg,#205a86,#347fb6);
}

@media (pointer: coarse) {
    .rag-crop-actions {
        flex-direction: column;
    }

    .rag-crop-actions button,
    .rag-crop-destination select {
        min-height: 50px;
    }
}




.explorerHasNineslice {
    display: none !important;
}

.rag-header-panel {
    background: rgba(110,40,145,.08);
}

.rag-header-grip {
    position: absolute;
    left: 4px;
    top: 4px;
    z-index: 2147481500;
    min-width: 52px;
    height: 24px;
    padding: 0 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    border: 1px solid rgba(255,255,255,.65);
    border-radius: 5px;
    background: rgba(20,20,24,.88);
    color: #f3d7ff;
    font: 900 9px/1 sans-serif;
    cursor: grab;
    user-select: none;
    touch-action: none;
}

.rag-header-grip:active {
    cursor: grabbing;
}

.rag-header-primary {
    background:
        linear-gradient(135deg,#541579,#9326be)
        !important;
}

.rag-header-delete {
    border-color: #8d3535 !important;
    background: #4b2424 !important;
}

[data-rag-header="true"] {
    outline-style: dashed !important;
}

@media (pointer: coarse) {
    .rag-header-grip {
        min-width: 70px;
        height: 34px;
        font-size: 10px;
    }

    .rag-crop-handle {
        width: 30px;
        height: 30px;
    }
}

.rag-image-tools {
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid rgba(175,75,235,.38);
}

.rag-image-tools button {
    margin-right: 6px;
    margin-bottom: 6px;
}

.rag-texture-path {
    margin-bottom: 6px;
    max-width: 100%;
    overflow-wrap: anywhere;
    color: #d98aff;
    font-size: 9px;
    font-weight: 800;
}

[data-rag-fallback-active="true"] {
    outline-color: #d100d1 !important;
}
`;
        document.head.appendChild(style);
    }

    // ============================================================
    // Init
    // ============================================================

    async function init() {
        installStyles();

        const viewport =
            document.querySelector('meta[name="viewport"]');

        if (viewport) {
            viewport.setAttribute(
                "content",
                "width=device-width, initial-scale=1.0, minimum-scale=0.25, maximum-scale=5.0, user-scalable=yes"
            );
        }

        mainWindow = document.getElementById("main_window");

        if (!mainWindow) return;

        if (hasTouch && window.PointerEvent) {
            for (const type of [
                "mousedown",
                "mousemove",
                "mouseup",
                "click",
                "dblclick",
            ]) {
                document.addEventListener(
                    type,
                    blockCompatibilityMouse,
                    true
                );
            }

            document.addEventListener(
                "pointerdown",
                pointerDown,
                { capture: true, passive: false }
            );

            document.addEventListener(
                "pointermove",
                pointerMove,
                { capture: true, passive: false }
            );

            document.addEventListener(
                "pointerup",
                pointerUp,
                { capture: true, passive: false }
            );

            document.addEventListener(
                "pointercancel",
                pointerCancel,
                { capture: true, passive: false }
            );

            document
                .getElementById("explorer")
                ?.addEventListener(
                    "pointerup",
                    explorerPointerUp,
                    { passive: true }
                );

            installTouchModeButton();
        }

        const mods = await loadModules();

        patchClipsChildrenExport(mods);
        patchGridSystem(mods);
        patchNestedPanelDrag(mods);

        await installImageParentLock();
        installFilePicker();
        await installImageResizeAndReplacement();
        await installHybridUpload();
        observeProperties();

        console.log(`[RAG JSON UI] Patch ${BUILD} pronto.`);
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            () => init(),
            { once: true }
        );
    } else {
        init();
    }
})();
