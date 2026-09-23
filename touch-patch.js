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
    window.__RAG_TOUCH_PATCH_BUILD__ = "v11-clean";

    const BUILD = "v11-clean";
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
            imageParentLock = selectedMainElement();

            try {
                return await oldOpen.apply(this, args);
            } finally {
                imageParentLock = previous;
            }
        };

        Builder.addCanvas = function (...args) {
            restoreImageParent();
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

            Canvas.prototype.resize = function (event) {
                if (
                    this.nineSlice ||
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

                originalChange.call(this, path);
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
                        element.dataset.ragKeepAspect === "true" &&
                        !instance.nineSlice
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
                        element.dataset.ragKeepAspect === "true" &&
                        !instance.nineSlice
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
                state.json
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
            exact,
            file
        );

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
