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
    window.__RAG_TOUCH_PATCH_BUILD__ = "v24-frame-copyfix";

    const BUILD = "v24-frame-copyfix";
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
            import("./dist/copy_paste/copy.js"),
            import("./dist/copy_paste/paste.js"),
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
            copyMod,
            pasteMod,
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
            Copier: copyMod.Copier,
            copyConversionMap: copyMod.conversionMap,
            Paster: pasteMod.Paster,
            pasteConversionMap: pasteMod.pasteConversionMap,
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
    // GRID V22 - visual grid without breaking child interaction
    // ============================================================

    function patchGridSystem(mods) {
        const shared =
            mods.ElementSharedFuncs;

        if (
            !shared ||
            shared.__ragGridV22
        ) {
            return;
        }

        shared.__ragGridV22 = true;

        const originalGrid =
            shared.grid;

        const originalSelect =
            shared.select;

        const originalUnselect =
            shared.unSelect;

        const originalStopDrag =
            shared.stopDrag;

        let activeGridOwner = null;

        function isImageOrButton(
            instance
        ) {
            const main =
                instance?.getMainHTMLElement?.();

            if (
                main?.dataset?.ragFixedDecorative ===
                "true"
            ) {
                return false;
            }

            return (
                instance instanceof
                    mods.DraggableCanvas ||
                instance instanceof
                    mods.DraggableButton
            );
        }

        function configureHitSurface(
            classElement
        ) {
            const grid =
                classElement?.gridElement;

            if (!grid) return;

            if (
                isImageOrButton(
                    classElement
                )
            ) {
                // The original editor uses gridElement as the actual
                // click/drag/select surface for images and buttons.
                grid.style.pointerEvents =
                    "auto";

                grid.style.zIndex =
                    "10";

                if (
                    classElement.resizeHandle
                ) {
                    classElement
                        .resizeHandle
                        .style.zIndex =
                        "30";
                }

                if (
                    classElement.centerCircle
                ) {
                    classElement
                        .centerCircle
                        .style.zIndex =
                        "31";
                }
            } else {
                // Panel/collection grids are visual helpers only.
                // They must never block nested children.
                grid.style.pointerEvents =
                    "none";

                grid.style.zIndex =
                    "0";
            }
        }

        function rawGrid(
            classElement,
            visible
        ) {
            const grid =
                classElement?.gridElement;

            if (
                !grid ||
                typeof classElement?.grid !==
                    "function"
            ) {
                return;
            }

            originalGrid.call(
                shared,
                visible,
                classElement
            );

            configureHitSurface(
                classElement
            );

            grid.classList.toggle(
                "rag-grid-visible",
                Boolean(visible)
            );
        }

        function hideAllGrids(
            except = null
        ) {
            for (
                const instance
                of mods.index
                    .GLOBAL_ELEMENT_MAP
                    .values()
            ) {
                if (
                    instance === except ||
                    !instance?.gridElement
                ) {
                    continue;
                }

                rawGrid(
                    instance,
                    false
                );
            }

            if (
                activeGridOwner !==
                except
            ) {
                activeGridOwner =
                    null;
            }
        }

        function showOnlyGrid(
            classElement
        ) {
            if (
                !classElement?.gridElement ||
                typeof classElement?.grid !==
                    "function"
            ) {
                hideAllGrids();
                return;
            }

            hideAllGrids(
                classElement
            );

            rawGrid(
                classElement,
                true
            );

            activeGridOwner =
                classElement;
        }

        shared.grid = function (
            showGrid,
            classElement
        ) {
            if (!showGrid) {
                rawGrid(
                    classElement,
                    false
                );

                if (
                    activeGridOwner ===
                    classElement
                ) {
                    activeGridOwner =
                        null;
                }

                return;
            }

            showOnlyGrid(
                classElement
            );
        };

        shared.select = function (
            event,
            classElement
        ) {
            const result =
                originalSelect.call(
                    this,
                    event,
                    classElement
                );

            if (
                classElement?.selected &&
                mods.config.settings
                    .show_grid?.value &&
                classElement?.gridElement
            ) {
                showOnlyGrid(
                    classElement
                );
            } else {
                hideAllGrids();
            }

            return result;
        };

        shared.unSelect = function (
            classElement
        ) {
            const result =
                originalUnselect.call(
                    this,
                    classElement
                );

            hideAllGrids();

            return result;
        };

        shared.stopDrag = function (
            classElement
        ) {
            const result =
                originalStopDrag.call(
                    this,
                    classElement
                );

            if (
                mods.config.settings
                    .show_grid?.value &&
                classElement?.selected &&
                classElement?.gridElement
            ) {
                showOnlyGrid(
                    classElement
                );
            } else {
                hideAllGrids();
            }

            return result;
        };

        // Apply hit-test behavior immediately, even when Show Grid is off.
        for (
            const instance
            of mods.index
                .GLOBAL_ELEMENT_MAP
                .values()
        ) {
            configureHitSurface(
                instance
            );
        }

        hideAllGrids();

        window.__RAG_GRID_V22__ = {
            hideAll: hideAllGrids,
            showOnly: showOnlyGrid,
            configure:
                configureHitSurface,
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

            // V21:
            // Keep the native sidecar passed by the original editor.
            // The custom 9-slice EDITOR stays removed, but rendering support
            // is necessary for backgrounds/buttons that already depend on it.
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
                // Native sidecar textures must use the editor's original
                // resize path. It understands nineslice_size and keeps
                // corners/borders intact while the element changes size.
                if (
                    this.nineSlice ||
                    this.canvasHolder.dataset.ragKeepAspect === "true"
                ) {
                    const result =
                        originalResize.call(
                            this,
                            event
                        );

                    if (
                        this.container?.dataset
                            ?.ragClipsChildren ===
                            "true"
                    ) {
                        const parent =
                            this.container
                                .getBoundingClientRect();

                        const left =
                            Math.max(
                                0,
                                parseFloat(
                                    this.canvasHolder
                                        .style.left
                                ) || 0
                            );

                        const top =
                            Math.max(
                                0,
                                parseFloat(
                                    this.canvasHolder
                                        .style.top
                                ) || 0
                            );

                        const outlineWidth =
                            parseFloat(
                                getComputedStyle(
                                    this.outlineDiv
                                ).outlineWidth
                            ) || 0;

                        const maxWidth =
                            Math.max(
                                1,
                                parent.width -
                                    left
                            );

                        const maxHeight =
                            Math.max(
                                1,
                                parent.height -
                                    top
                            );

                        const currentW =
                            (
                                parseFloat(
                                    this.outlineDiv
                                        .style.width
                                ) || maxWidth
                            ) +
                            outlineWidth;

                        const currentH =
                            (
                                parseFloat(
                                    this.outlineDiv
                                        .style.height
                                ) || maxHeight
                            ) +
                            outlineWidth;

                        this.outlineDiv
                            .style.width =
                            `${
                                Math.max(
                                    1,
                                    Math.min(
                                        currentW,
                                        maxWidth
                                    ) -
                                    outlineWidth
                                )
                            }px`;

                        this.outlineDiv
                            .style.height =
                            `${
                                Math.max(
                                    1,
                                    Math.min(
                                        currentH,
                                        maxHeight
                                    ) -
                                    outlineWidth
                                )
                            }px`;
                    }

                    return result;
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

                if (
                    this.container?.dataset
                        ?.ragClipsChildren ===
                        "true"
                ) {
                    const left =
                        Math.max(
                            0,
                            parseFloat(
                                this.canvasHolder
                                    .style.left
                            ) || 0
                        );

                    const top =
                        Math.max(
                            0,
                            parseFloat(
                                this.canvasHolder
                                    .style.top
                            ) || 0
                        );

                    width =
                        Math.min(
                            width,
                            Math.max(
                                1,
                                container.width -
                                    left
                            )
                        );

                    height =
                        Math.min(
                            height,
                            Math.max(
                                1,
                                container.height -
                                    top
                            )
                        );
                }

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

                // Restore the original editor behavior: if the texture has a
                // JSON sidecar, changeImage loads it into this.nineSlice.
                originalChange.call(this, path);

                // Keep the user's layout box exactly where it was.
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

            if (
                ["edit_box", "dropdown", "toggle", "slider"]
                    .includes(type)
            ) {
                instance.panel.dataset.ragControlType =
                    type;

                if (type === "edit_box") {
                    instance.panel.dataset.ragControlName =
                        String(
                            resolveVariable(
                                json.text_box_name,
                                vars
                            ) || "text_box"
                        );

                    instance.panel.dataset.ragPlaceholder =
                        String(
                            resolveVariable(
                                json.placeholder_text,
                                vars
                            ) || "Digite aqui"
                        );

                    instance.panel.dataset.ragMaxLength =
                        String(
                            Number(
                                resolveVariable(
                                    json.max_length,
                                    vars
                                )
                            ) || 100
                        );

                    instance.panel.dataset.ragTextType =
                        String(
                            resolveVariable(
                                json.text_type,
                                vars
                            ) || "ExtendedASCII"
                        );

                    instance.panel.dataset.ragMultiline =
                        String(
                            Boolean(
                                resolveVariable(
                                    json.enabled_newline,
                                    vars
                                )
                            )
                        );
                }

                if (type === "dropdown") {
                    instance.panel.dataset.ragDropdownName =
                        String(
                            resolveVariable(
                                json.dropdown_name,
                                vars
                            ) || "dropdown"
                        );

                    instance.panel.dataset.ragDropdownContent =
                        String(
                            resolveVariable(
                                json.dropdown_content_control,
                                vars
                            ) || "dropdown_content"
                        );

                    instance.panel.dataset.ragDropdownArea =
                        String(
                            resolveVariable(
                                json.dropdown_area,
                                vars
                            ) || "dropdown_area"
                        );

                    instance.panel.dataset.ragPreviewText =
                        String(
                            resolveVariable(
                                json.$button_text,
                                vars
                            ) || "Selecionar"
                        );
                }

                if (type === "toggle") {
                    instance.panel.dataset.ragToggleName =
                        String(
                            resolveVariable(
                                json.toggle_name,
                                vars
                            ) || "toggle"
                        );

                    instance.panel.dataset.ragToggleText =
                        String(
                            resolveVariable(
                                json.$button_text,
                                vars
                            ) || "Toggle"
                        );

                    instance.panel.dataset.ragToggleDefault =
                        String(
                            Boolean(
                                resolveVariable(
                                    json.toggle_default_state,
                                    vars
                                )
                            )
                        );
                }

                if (type === "slider") {
                    instance.panel.dataset.ragSliderSteps =
                        String(
                            Number(
                                resolveVariable(
                                    json.slider_steps,
                                    vars
                                )
                            ) || 10
                        );

                    instance.panel.dataset.ragSliderDirection =
                        String(
                            resolveVariable(
                                json.slider_direction,
                                vars
                            ) || "horizontal"
                        );
                }

                updateDesignerControlVisual(
                    instance
                );
            }

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

        element.dataset.ragClipsChildren =
            String(enabled);

        element.style.overflow =
            enabled
                ? "hidden"
                : "visible";

        if (
            enabled &&
            window.__RAG_CONTAINER_V22__
        ) {
            for (
                const child
                of element.children
            ) {
                if (
                    !(child instanceof HTMLElement) ||
                    !child.dataset?.id ||
                    child.dataset.skip === "true"
                ) {
                    continue;
                }

                const childInstance =
                    window.__RAG_LAST_MODS_V22__
                        ?.index
                        ?.GLOBAL_ELEMENT_MAP
                        ?.get(
                            child.dataset.id
                        );

                if (childInstance) {
                    window.__RAG_CONTAINER_V22__
                        .clamp(
                            childInstance
                        );
                }
            }
        }
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
        const shared =
            mods.ElementSharedFuncs;

        if (
            shared.__ragContainersV22
        ) {
            return;
        }

        shared.__ragContainersV22 =
            true;

        function isContainerElement(
            element
        ) {
            return Boolean(
                element?.classList?.contains(
                    "draggable-panel"
                ) ||
                element?.classList?.contains(
                    "draggable-collection_panel"
                ) ||
                element?.classList?.contains(
                    "draggable-scrolling_panel"
                )
            );
        }

        function enableDefaultClipping(
            instance
        ) {
            const element =
                instance
                    ?.getMainHTMLElement
                    ?.();

            if (
                !element ||
                element ===
                    mods.config.rootElement
            ) {
                return;
            }

            if (
                !isContainerElement(
                    element
                )
            ) {
                return;
            }

            if (
                element.dataset
                    .ragClipsChildren ===
                undefined
            ) {
                element.dataset
                    .ragClipsChildren =
                    "true";
            }

            element.style.overflow =
                element.dataset
                    .ragClipsChildren ===
                "true"
                    ? "hidden"
                    : "visible";
        }

        function wrapContainerClass(
            Klass
        ) {
            if (
                !Klass ||
                Klass.prototype
                    .__ragContainerV22
            ) {
                return;
            }

            Klass.prototype
                .__ragContainerV22 =
                true;

            const originalInitEvents =
                Klass.prototype.initEvents;

            const originalStartDrag =
                Klass.prototype.startDrag;

            Klass.prototype.initEvents =
                function (...args) {
                    enableDefaultClipping(
                        this
                    );

                    return originalInitEvents
                        .apply(
                            this,
                            args
                        );
                };

            Klass.prototype.startDrag =
                function (event) {
                    const target =
                        event.target;

                    if (
                        target instanceof
                            Element
                    ) {
                        const owner =
                            target.closest(
                                "[data-id]"
                            );

                        if (
                            owner &&
                            owner !==
                                this.getMainHTMLElement() &&
                            this.getMainHTMLElement()
                                .contains(owner)
                        ) {
                            event.stopPropagation();
                            return;
                        }
                    }

                    return originalStartDrag
                        .call(
                            this,
                            event
                        );
                };
        }

        wrapContainerClass(
            mods.DraggablePanel
        );

        wrapContainerClass(
            mods.DraggableCollectionPanel
        );

        function shouldConstrainToParent(
            classElement
        ) {
            const parent =
                classElement?.container;

            return Boolean(
                parent &&
                parent !==
                    mods.config.rootElement &&
                isContainerElement(
                    parent
                ) &&
                parent.dataset
                    .ragClipsChildren ===
                    "true"
            );
        }

        function clampChild(
            classElement,
            mainElement
        ) {
            if (
                !shouldConstrainToParent(
                    classElement
                )
            ) {
                return;
            }

            const parent =
                classElement.container;

            const element =
                mainElement ||
                classElement
                    .getMainHTMLElement();

            if (!element) return;

            const parentRect =
                parent.getBoundingClientRect();

            const rect =
                element.getBoundingClientRect();

            const width =
                rect.width ||
                element.offsetWidth ||
                1;

            const height =
                rect.height ||
                element.offsetHeight ||
                1;

            let left =
                parseFloat(
                    element.style.left
                );

            let top =
                parseFloat(
                    element.style.top
                );

            if (
                !Number.isFinite(left)
            ) {
                left = 0;
            }

            if (
                !Number.isFinite(top)
            ) {
                top = 0;
            }

            const maxLeft =
                Math.max(
                    0,
                    parentRect.width -
                        width
                );

            const maxTop =
                Math.max(
                    0,
                    parentRect.height -
                        height
                );

            element.style.left =
                `${
                    Math.max(
                        0,
                        Math.min(
                            left,
                            maxLeft
                        )
                    )
                }px`;

            element.style.top =
                `${
                    Math.max(
                        0,
                        Math.min(
                            top,
                            maxTop
                        )
                    )
                }px`;
        }

        const originalDrag =
            shared.drag;

        shared.drag = function (
            event,
            classElement,
            mainElement
        ) {
            const result =
                originalDrag.call(
                    this,
                    event,
                    classElement,
                    mainElement
                );

            clampChild(
                classElement,
                mainElement
            );

            return result;
        };

        const originalResize =
            shared.resize;

        shared.resize = function (
            event,
            classElement
        ) {
            const result =
                originalResize.call(
                    this,
                    event,
                    classElement
                );

            if (
                shouldConstrainToParent(
                    classElement
                )
            ) {
                const parent =
                    classElement.container;

                const element =
                    classElement
                        .getMainHTMLElement();

                const parentRect =
                    parent.getBoundingClientRect();

                const left =
                    Math.max(
                        0,
                        parseFloat(
                            element.style.left
                        ) || 0
                    );

                const top =
                    Math.max(
                        0,
                        parseFloat(
                            element.style.top
                        ) || 0
                    );

                const maxWidth =
                    Math.max(
                        1,
                        parentRect.width -
                            left
                    );

                const maxHeight =
                    Math.max(
                        1,
                        parentRect.height -
                            top
                    );

                const width =
                    Math.min(
                        parseFloat(
                            element.style.width
                        ) ||
                            element.offsetWidth ||
                            1,
                        maxWidth
                    );

                const height =
                    Math.min(
                        parseFloat(
                            element.style.height
                        ) ||
                            element.offsetHeight ||
                            1,
                        maxHeight
                    );

                element.style.width =
                    `${width}px`;

                element.style.height =
                    `${height}px`;
            }

            return result;
        };

        for (
            const instance
            of mods.index
                .GLOBAL_ELEMENT_MAP
                .values()
        ) {
            enableDefaultClipping(
                instance
            );
        }

        window.__RAG_CONTAINER_V22__ = {
            enable:
                enableDefaultClipping,
            clamp:
                clampChild,
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
        mods,
        requestedTexturePath = null
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
            requestedTexturePath
                ? normalizeTexture(
                    requestedTexturePath
                )
                : ensureHeaderDefaultTexture(
                    mods
                );

        const state =
            requestedTexturePath
                ? await ensureTexture(
                    texturePath
                )
                : mods.index.images.get(
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
                state.json
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
            .ragFixedDecorative =
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

        // V21: native sidecars are valid rendering metadata.
        // The custom editor is gone, but the rendering format is restored.
        background.changeImage(
            path
        );

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
    // V23: COPY / PASTE, AUTO HEADER+BORDER, FORM CONTROLS
    // ============================================================

    let chromeResizeObserver = null;

    function randomDesignerName(prefix) {
        return (
            prefix +
            "_" +
            Math.random()
                .toString(36)
                .slice(2, 7)
        );
    }

    function nearestValidContainer(
        mods,
        startElement = null
    ) {
        let current =
            startElement ||
            mods.index.selectedElement;

        while (current) {
            if (
                current.dataset?.id &&
                mods.index.Builder.isValidPath(
                    current
                )
            ) {
                return current;
            }

            if (
                current ===
                mods.config.rootElement
            ) {
                break;
            }

            current =
                current.parentElement;
        }

        return (
            mods.config.rootElement ||
            null
        );
    }

    function selectedPanelForChrome(mods) {
        let current =
            mods.index.selectedElement;

        while (current) {
            const id =
                current.dataset?.id;

            if (id) {
                const instance =
                    mods.index.GLOBAL_ELEMENT_MAP.get(
                        id
                    );

                if (
                    instance instanceof
                        mods.DraggablePanel ||
                    instance instanceof
                        mods.DraggableCollectionPanel
                ) {
                    return instance;
                }
            }

            if (
                current ===
                mods.config.rootElement
            ) {
                break;
            }

            current =
                current.parentElement;
        }

        return null;
    }

    function updateDesignerControlVisual(
        instance
    ) {
        const host =
            instance?.getMainHTMLElement?.();

        if (!host) return;

        host.querySelector(
            ":scope > .rag-control-preview"
        )?.remove();

        const type =
            host.dataset.ragControlType;

        if (!type) return;

        const preview =
            document.createElement(
                "div"
            );

        preview.className =
            `rag-control-preview rag-control-${type}`;

        preview.dataset.skip =
            "true";

        preview.style.pointerEvents =
            "none";

        if (type === "edit_box") {
            const placeholder =
                document.createElement(
                    "span"
                );

            placeholder.textContent =
                host.dataset
                    .ragPlaceholder ||
                "Digite aqui";

            preview.appendChild(
                placeholder
            );
        }

        if (type === "dropdown") {
            const label =
                document.createElement(
                    "span"
                );

            label.textContent =
                host.dataset
                    .ragPreviewText ||
                "Selecionar";

            const arrow =
                document.createElement(
                    "span"
                );

            arrow.className =
                "rag-dropdown-arrow";

            arrow.textContent =
                "▼";

            preview.append(
                label,
                arrow
            );
        }

        if (type === "toggle") {
            const mark =
                document.createElement(
                    "span"
                );

            mark.className =
                "rag-toggle-box";

            mark.textContent =
                host.dataset
                    .ragToggleDefault ===
                "true"
                    ? "✓"
                    : "";

            const text =
                document.createElement(
                    "span"
                );

            text.textContent =
                host.dataset
                    .ragToggleText ||
                "Toggle";

            preview.append(
                mark,
                text
            );
        }

        if (type === "slider") {
            const track =
                document.createElement(
                    "div"
                );

            track.className =
                "rag-slider-track";

            const thumb =
                document.createElement(
                    "div"
                );

            thumb.className =
                "rag-slider-thumb";

            track.appendChild(
                thumb
            );

            preview.appendChild(
                track
            );
        }

        host.appendChild(
            preview
        );
    }

    function createDesignerControl(
        type,
        mods
    ) {
        const parent =
            nearestValidContainer(
                mods
            );

        if (!parent) {
            showBanner(
                "Selecione um painel de destino.",
                "error"
            );
            return null;
        }

        const id =
            crypto.randomUUID?.()
                ?.replace(/-/g, "")
                .slice(0, 15) ||
            Math.random()
                .toString(36)
                .slice(2, 17);

        const control =
            new mods.DraggablePanel(
                id,
                parent,
                true
            );

        mods.index.GLOBAL_ELEMENT_MAP.set(
            id,
            control
        );

        const host =
            control.panel;

        host.dataset.ragControlType =
            type;

        host.dataset.ragClipsChildren =
            "false";

        host.style.overflow =
            "visible";

        host.style.backgroundColor =
            "rgba(0,0,0,0)";

        if (type === "edit_box") {
            host.style.width =
                "260px";
            host.style.height =
                "48px";

            host.dataset.ragControlName =
                randomDesignerName(
                    "text_box"
                );

            host.dataset.ragPlaceholder =
                "Digite aqui";

            host.dataset.ragMaxLength =
                "100";

            host.dataset.ragTextType =
                "ExtendedASCII";

            host.dataset.ragMultiline =
                "false";
        }

        if (type === "dropdown") {
            host.style.width =
                "240px";
            host.style.height =
                "48px";

            host.dataset.ragDropdownName =
                randomDesignerName(
                    "dropdown"
                );

            host.dataset.ragDropdownContent =
                "dropdown_content";

            host.dataset.ragDropdownArea =
                "dropdown_area";

            host.dataset.ragPreviewText =
                "Selecionar";
        }

        if (type === "toggle") {
            host.style.width =
                "150px";
            host.style.height =
                "44px";

            host.dataset.ragToggleName =
                randomDesignerName(
                    "toggle"
                );

            host.dataset.ragToggleText =
                "Toggle";

            host.dataset.ragToggleDefault =
                "false";
        }

        if (type === "slider") {
            host.style.width =
                "240px";
            host.style.height =
                "38px";

            host.dataset.ragSliderSteps =
                "10";

            host.dataset.ragSliderDirection =
                "horizontal";
        }

        updateDesignerControlVisual(
            control
        );

        mods.index.Builder.updateExplorer();

        control.select(
            new MouseEvent(
                "dblclick",
                {
                    bubbles: true,
                    cancelable: true,
                }
            )
        );

        return control;
    }

    function buildNativeControlJson(
        element,
        baseResult
    ) {
        const type =
            element.dataset.ragControlType;

        if (!type) return null;

        const result =
            baseResult;

        const out =
            result.element;

        result.instructions.ContinuePath =
            false;

        delete out.clips_children;
        delete out.allow_clipping;
        delete out.controls;

        if (type === "edit_box") {
            out.type =
                "edit_box";

            out.text_box_name =
                element.dataset
                    .ragControlName ||
                "text_box";

            out.constrain_to_rect =
                true;

            out.enabled_newline =
                element.dataset
                    .ragMultiline ===
                "true";

            out.text_type =
                element.dataset
                    .ragTextType ||
                "ExtendedASCII";

            out.max_length =
                Number(
                    element.dataset
                        .ragMaxLength
                ) || 100;

            out.text_control =
                "text";

            out.place_holder_control =
                "placeholder";

            out.controls = [
                {
                    text: {
                        type: "label",
                        text: "#text",
                        anchor_from:
                            "left_middle",
                        anchor_to:
                            "left_middle",
                        offset: [6, 0],
                        bindings: [
                            {
                                binding_name:
                                    "#text",
                            },
                        ],
                    },
                },
                {
                    placeholder: {
                        type: "label",
                        text:
                            element.dataset
                                .ragPlaceholder ||
                            "Digite aqui",
                        anchor_from:
                            "left_middle",
                        anchor_to:
                            "left_middle",
                        offset: [6, 0],
                    },
                },
            ];
        }

        if (type === "dropdown") {
            out.type =
                "dropdown";

            out.dropdown_name =
                element.dataset
                    .ragDropdownName ||
                "dropdown";

            out.dropdown_content_control =
                element.dataset
                    .ragDropdownContent ||
                "dropdown_content";

            out.dropdown_area =
                element.dataset
                    .ragDropdownArea ||
                "dropdown_area";

            out.controls = [
                {
                    dropdown_area: {
                        type: "panel",
                        size:
                            ["100%", "100%"],
                        controls: [
                            {
                                label: {
                                    type: "label",
                                    text:
                                        element.dataset
                                            .ragPreviewText ||
                                        "Selecionar",
                                    anchor_from:
                                        "left_middle",
                                    anchor_to:
                                        "left_middle",
                                    offset:
                                        [6, 0],
                                },
                            },
                        ],
                    },
                },
                {
                    dropdown_content: {
                        type: "panel",
                        size:
                            ["100%", 80],
                        offset:
                            [0, "100%"],
                    },
                },
            ];
        }

        if (type === "toggle") {
            out.type =
                "toggle";

            out.toggle_name =
                element.dataset
                    .ragToggleName ||
                "toggle";

            out.toggle_default_state =
                element.dataset
                    .ragToggleDefault ===
                "true";

            out.unchecked_control =
                "unchecked";

            out.checked_control =
                "checked";

            out.controls = [
                {
                    unchecked: {
                        type: "label",
                        text:
                            "☐ " +
                            (
                                element.dataset
                                    .ragToggleText ||
                                "Toggle"
                            ),
                        anchor_from:
                            "left_middle",
                        anchor_to:
                            "left_middle",
                    },
                },
                {
                    checked: {
                        type: "label",
                        text:
                            "☑ " +
                            (
                                element.dataset
                                    .ragToggleText ||
                                "Toggle"
                            ),
                        anchor_from:
                            "left_middle",
                        anchor_to:
                            "left_middle",
                    },
                },
            ];
        }

        if (type === "slider") {
            out.type =
                "slider";

            out.slider_steps =
                Number(
                    element.dataset
                        .ragSliderSteps
                ) || 10;

            out.slider_direction =
                element.dataset
                    .ragSliderDirection ||
                "horizontal";
        }

        return result;
    }

    function patchAdvancedControlExport(
        mods
    ) {
        if (
            mods.classToJsonUI
                .__ragControlsV23
        ) {
            return;
        }

        mods.classToJsonUI
            .__ragControlsV23 =
            true;

        const original =
            mods.classToJsonUI.get(
                "draggable-panel"
            );

        if (!original) return;

        mods.classToJsonUI.set(
            "draggable-panel",
            (
                element,
                namespace
            ) => {
                const result =
                    original(
                        element,
                        namespace
                    );

                if (
                    element.dataset
                        .ragControlType
                ) {
                    return (
                        buildNativeControlJson(
                            element,
                            result
                        ) ||
                        result
                    );
                }

                return result;
            }
        );
    }

    function appendControlPropertyTools(
        panelBox,
        panelInstance
    ) {
        const host =
            panelMainElement(
                panelInstance
            );

        const type =
            host?.dataset
                ?.ragControlType;

        if (!type) return;

        const divider =
            document.createElement(
                "div"
            );

        divider.className =
            "rag-control-tools-title";

        divider.textContent =
            type === "edit_box"
                ? "CAMPO DE TEXTO"
                : type === "dropdown"
                ? "DROPDOWN"
                : type === "toggle"
                ? "TOGGLE"
                : "SLIDER";

        panelBox.appendChild(
            divider
        );

        const addTextInput = (
            labelText,
            key,
            fallback
        ) => {
            const label =
                document.createElement(
                    "label"
                );

            label.className =
                "rag-control-property-label";

            label.textContent =
                labelText;

            const input =
                document.createElement(
                    "input"
                );

            input.className =
                "propertyInput";

            input.type =
                "text";

            input.value =
                host.dataset[key] ||
                fallback;

            input.addEventListener(
                "input",
                () => {
                    host.dataset[key] =
                        input.value;

                    updateDesignerControlVisual(
                        panelInstance
                    );
                }
            );

            panelBox.append(
                label,
                input
            );

            return input;
        };

        const addNumberInput = (
            labelText,
            key,
            fallback,
            min = 1
        ) => {
            const label =
                document.createElement(
                    "label"
                );

            label.className =
                "rag-control-property-label";

            label.textContent =
                labelText;

            const input =
                document.createElement(
                    "input"
                );

            input.className =
                "propertyInput";

            input.type =
                "number";

            input.min =
                String(min);

            input.value =
                host.dataset[key] ||
                String(fallback);

            input.addEventListener(
                "input",
                () => {
                    host.dataset[key] =
                        String(
                            Math.max(
                                min,
                                Number(
                                    input.value
                                ) ||
                                    fallback
                            )
                        );
                }
            );

            panelBox.append(
                label,
                input
            );

            return input;
        };

        const addSelect = (
            labelText,
            key,
            options,
            fallback
        ) => {
            const label =
                document.createElement(
                    "label"
                );

            label.className =
                "rag-control-property-label";

            label.textContent =
                labelText;

            const select =
                document.createElement(
                    "select"
                );

            select.className =
                "propertyInput";

            for (
                const value
                of options
            ) {
                const option =
                    document.createElement(
                        "option"
                    );

                option.value =
                    value;

                option.textContent =
                    value;

                select.appendChild(
                    option
                );
            }

            select.value =
                host.dataset[key] ||
                fallback;

            select.addEventListener(
                "change",
                () => {
                    host.dataset[key] =
                        select.value;

                    updateDesignerControlVisual(
                        panelInstance
                    );
                }
            );

            panelBox.append(
                label,
                select
            );

            return select;
        };

        const addCheck = (
            labelText,
            key,
            fallback = false
        ) => {
            const row =
                document.createElement(
                    "label"
                );

            row.className =
                "rag-control-check-row";

            const input =
                document.createElement(
                    "input"
                );

            input.type =
                "checkbox";

            input.checked =
                (
                    host.dataset[key] ??
                    String(fallback)
                ) ===
                "true";

            const text =
                document.createElement(
                    "span"
                );

            text.textContent =
                labelText;

            input.addEventListener(
                "change",
                () => {
                    host.dataset[key] =
                        String(
                            input.checked
                        );

                    updateDesignerControlVisual(
                        panelInstance
                    );
                }
            );

            row.append(
                input,
                text
            );

            panelBox.appendChild(
                row
            );

            return input;
        };

        if (type === "edit_box") {
            addTextInput(
                "Nome do campo",
                "ragControlName",
                "text_box"
            );

            addTextInput(
                "Placeholder",
                "ragPlaceholder",
                "Digite aqui"
            );

            addNumberInput(
                "Max length",
                "ragMaxLength",
                100
            );

            addSelect(
                "Tipo de texto",
                "ragTextType",
                [
                    "ExtendedASCII",
                    "IdentifierChars",
                    "NumberChars",
                ],
                "ExtendedASCII"
            );

            addCheck(
                "Multiline",
                "ragMultiline",
                false
            );
        }

        if (type === "dropdown") {
            addTextInput(
                "Nome",
                "ragDropdownName",
                "dropdown"
            );

            addTextInput(
                "Texto de preview",
                "ragPreviewText",
                "Selecionar"
            );

            addTextInput(
                "Content control",
                "ragDropdownContent",
                "dropdown_content"
            );

            addTextInput(
                "Area control",
                "ragDropdownArea",
                "dropdown_area"
            );
        }

        if (type === "toggle") {
            addTextInput(
                "Nome",
                "ragToggleName",
                "toggle"
            );

            addTextInput(
                "Texto",
                "ragToggleText",
                "Toggle"
            );

            addCheck(
                "Ligado por padrao",
                "ragToggleDefault",
                false
            );
        }

        if (type === "slider") {
            addNumberInput(
                "Steps",
                "ragSliderSteps",
                10
            );

            addSelect(
                "Direcao",
                "ragSliderDirection",
                [
                    "horizontal",
                    "vertical",
                ],
                "horizontal"
            );
        }
    }

    function copyRagDataset(
        element
    ) {
        const data = {};

        for (
            const [key, value]
            of Object.entries(
                element.dataset
            )
        ) {
            if (
                key.startsWith(
                    "rag"
                )
            ) {
                data[key] =
                    value;
            }
        }

        return data;
    }

    function restoreRagDataset(
        element,
        data
    ) {
        if (!data) return;

        for (
            const [key, value]
            of Object.entries(
                data
            )
        ) {
            element.dataset[key] =
                String(value);
        }
    }

    function patchCopyPasteMetadata(
        mods
    ) {
        if (
            mods.copyConversionMap
                .__ragV23
        ) {
            return;
        }

        mods.copyConversionMap
            .__ragV23 = true;

        const oldPanelCopy =
            mods.copyConversionMap.get(
                "draggable-panel"
            );

        if (oldPanelCopy) {
            mods.copyConversionMap.set(
                "draggable-panel",
                (instance) => {
                    const data =
                        oldPanelCopy(
                            instance
                        );

                    if (!data) {
                        return data;
                    }

                    data.ragDataset =
                        copyRagDataset(
                            instance
                                .getMainHTMLElement()
                        );

                    return data;
                }
            );
        }

        const oldCanvasCopy =
            mods.copyConversionMap.get(
                "draggable-canvas"
            );

        if (oldCanvasCopy) {
            mods.copyConversionMap.set(
                "draggable-canvas",
                (instance) => {
                    const data =
                        oldCanvasCopy(
                            instance
                        );

                    if (!data) {
                        return data;
                    }

                    data.ragDataset =
                        copyRagDataset(
                            instance
                                .getMainHTMLElement()
                        );

                    return data;
                }
            );
        }

        const oldPanelPaste =
            mods.pasteConversionMap.get(
                "draggable-panel"
            );

        if (oldPanelPaste) {
            mods.pasteConversionMap.set(
                "draggable-panel",
                (
                    copied,
                    parent,
                    isChild = false
                ) => {
                    const before =
                        new Set(
                            mods.index
                                .GLOBAL_ELEMENT_MAP
                                .keys()
                        );

                    oldPanelPaste(
                        copied,
                        parent,
                        isChild
                    );

                    let created =
                        null;

                    for (
                        const [id, instance]
                        of mods.index
                            .GLOBAL_ELEMENT_MAP
                    ) {
                        if (
                            before.has(id)
                        ) {
                            continue;
                        }

                        if (
                            instance instanceof
                                mods.DraggablePanel &&
                            instance.container ===
                                parent
                        ) {
                            created =
                                instance;
                            break;
                        }
                    }

                    if (!created) {
                        return;
                    }

                    const element =
                        created
                            .getMainHTMLElement();

                    restoreRagDataset(
                        element,
                        copied.ragDataset
                    );

                    if (
                        element.dataset
                            .ragClipsChildren ===
                        "true"
                    ) {
                        element.style.overflow =
                            "hidden";
                    }

                    if (
                        element.dataset
                            .ragControlType
                    ) {
                        updateDesignerControlVisual(
                            created
                        );
                    }

                    if (
                        element.dataset
                            .ragHeader ===
                        "true"
                    ) {
                        installHeaderGrip(
                            created
                        );

                        ensureHeaderResizeObserver(
                            mods
                        );

                        headerResizeObserver
                            ?.observe(
                                element
                            );
                    }
                }
            );
        }

        const oldCanvasPaste =
            mods.pasteConversionMap.get(
                "draggable-canvas"
            );

        if (oldCanvasPaste) {
            mods.pasteConversionMap.set(
                "draggable-canvas",
                (
                    copied,
                    parent,
                    isChild = false
                ) => {
                    const before =
                        new Set(
                            mods.index
                                .GLOBAL_ELEMENT_MAP
                                .keys()
                        );

                    oldCanvasPaste(
                        copied,
                        parent,
                        isChild
                    );

                    for (
                        const [id, instance]
                        of mods.index
                            .GLOBAL_ELEMENT_MAP
                    ) {
                        if (
                            before.has(id) ||
                            !(
                                instance instanceof
                                    mods.DraggableCanvas
                            ) ||
                            instance.container !==
                                parent
                        ) {
                            continue;
                        }

                        restoreRagDataset(
                            instance
                                .getMainHTMLElement(),
                            copied.ragDataset
                        );

                        if (
                            instance
                                .canvasHolder
                                .dataset
                                .ragFixedDecorative ===
                            "true"
                        ) {
                            instance
                                .canvasHolder
                                .style
                                .pointerEvents =
                                "none";

                            instance
                                .resizeHandle
                                .style.display =
                                "none";
                        }

                        break;
                    }
                }
            );
        }
    }

    function resolvePasteDestination(
        mods,
        copied
    ) {
        const selected =
            mods.index.selectedElement;

        const root =
            mods.config.rootElement;

        if (!selected) {
            return root;
        }

        const selectedId =
            selected.dataset?.id;

        const copiedOldId =
            copied?.oldId;

        const selectedInstance =
            selectedId
                ? mods.index
                    .GLOBAL_ELEMENT_MAP
                    .get(selectedId)
                : null;

        const isContainer =
            selectedInstance instanceof
                mods.DraggablePanel ||
            selectedInstance instanceof
                mods.DraggableCollectionPanel;

        // Most important rule:
        // if the same copied element is still selected, paste beside it,
        // NOT inside it.
        if (
            copiedOldId &&
            selectedId === copiedOldId
        ) {
            return (
                nearestValidContainer(
                    mods,
                    selected.parentElement
                ) || root
            );
        }

        // If user intentionally selected another panel/header/content slot,
        // paste into that selected container.
        if (
            isContainer &&
            mods.index.Builder.isValidPath(
                selected
            )
        ) {
            return selected;
        }

        // If a child image/label/button is selected, paste into its nearest
        // parent panel as a sibling.
        return (
            nearestValidContainer(
                mods,
                selected.parentElement
            ) || root
        );
    }

    function selectAndOffsetPasted(
        beforeIds,
        destination,
        mods
    ) {
        let created =
            null;

        for (
            const [id, instance]
            of mods.index
                .GLOBAL_ELEMENT_MAP
        ) {
            if (
                beforeIds.has(id)
            ) {
                continue;
            }

            if (
                instance.container ===
                destination
            ) {
                created =
                    instance;
                break;
            }
        }

        if (!created) {
            return null;
        }

        const element =
            created.getMainHTMLElement();

        const left =
            parseFloat(
                element.style.left
            ) || 0;

        const top =
            parseFloat(
                element.style.top
            ) || 0;

        element.style.left =
            `${left + 12}px`;

        element.style.top =
            `${top + 12}px`;

        // Clamp to parent if needed.
        window.__RAG_CONTAINER_V22__
            ?.clamp?.(
                created
            );

        try {
            created.select(
                new MouseEvent(
                    "dblclick",
                    {
                        bubbles: true,
                        cancelable: true,
                    }
                )
            );
        } catch (_) {}

        return created;
    }

    function installCopyPasteButtons(
        mods
    ) {
        if (
            document.querySelector(
                ".rag-copy-paste-tools"
            )
        ) {
            return;
        }

        const util =
            document.querySelector(
                ".utilElements"
            );

        if (!util) return;

        const row =
            document.createElement(
                "div"
            );

        row.className =
            "rag-copy-paste-tools";

        const copy =
            document.createElement(
                "button"
            );

        copy.type =
            "button";

        copy.className =
            "utilElement";

        copy.textContent =
            "COPIAR";

        const paste =
            document.createElement(
                "button"
            );

        paste.type =
            "button";

        paste.className =
            "utilElement";

        paste.textContent =
            "COLAR";

        copy.addEventListener(
            "click",
            () => {
                const selected =
                    mods.index
                        .selectedElement;

                if (
                    !selected?.dataset?.id
                ) {
                    showBanner(
                        "Selecione algo para copiar.",
                        "error"
                    );
                    return;
                }

                mods.Copier.copyElement(
                    selected.dataset.id
                );

                showBanner(
                    "Elemento copiado.",
                    "success"
                );
            }
        );

        paste.addEventListener(
            "click",
            () => {
                const copied =
                    mods.index
                        .copiedElementData;

                if (!copied) {
                    showBanner(
                        "Nada foi copiado ainda.",
                        "error"
                    );
                    return;
                }

                const destination =
                    resolvePasteDestination(
                        mods,
                        copied
                    );

                if (!destination) {
                    showBanner(
                        "Nenhum painel de destino encontrado.",
                        "error"
                    );
                    return;
                }

                if (
                    !mods.index.Builder
                        .isValidPath(
                            destination
                        )
                ) {
                    showBanner(
                        "O destino nao aceita filhos.",
                        "error"
                    );
                    return;
                }

                const pasteFn =
                    mods.pasteConversionMap
                        .get(
                            copied.type
                        );

                if (!pasteFn) {
                    showBanner(
                        "Esse elemento nao pode ser colado.",
                        "error"
                    );
                    return;
                }

                const beforeIds =
                    new Set(
                        mods.index
                            .GLOBAL_ELEMENT_MAP
                            .keys()
                    );

                // true = preserve original child position.
                pasteFn(
                    copied,
                    destination,
                    true
                );

                const created =
                    selectAndOffsetPasted(
                        beforeIds,
                        destination,
                        mods
                    );

                mods.index.Builder
                    .updateExplorer();

                showBanner(
                    created
                        ? "Elemento colado no painel selecionado."
                        : "Elemento colado.",
                    "success"
                );
            }
        );

        row.append(
            copy,
            paste
        );

        util.insertBefore(
            row,
            util.children[2] ||
                null
        );
    }

    function ensureGeneratedLineTexture(
        mods
    ) {
        const path =
            "rag_generated/frame_line";

        if (
            mods.index.images.get(path)
                ?.png
        ) {
            return path;
        }

        const canvas =
            document.createElement(
                "canvas"
            );

        canvas.width =
            4;

        canvas.height =
            4;

        const ctx =
            canvas.getContext(
                "2d",
                {
                    willReadFrequently: true,
                }
            );

        ctx.fillStyle =
            "#17181a";

        ctx.fillRect(
            0,
            0,
            4,
            4
        );

        ctx.fillStyle =
            "#55595e";

        ctx.fillRect(
            1,
            1,
            2,
            2
        );

        const png =
            ctx.getImageData(
                0,
                0,
                4,
                4
            );

        mods.index.images.set(
            path,
            {
                png,
                __ragFrameLine:
                    true,
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
                        autoFrameLine: true,
                    },
                })
            );
        } catch (_) {}

        return path;
    }

    function pathDirectory(
        path
    ) {
        const normalized =
            normalizeTexture(
                path
            );

        const index =
            normalized.lastIndexOf(
                "/"
            );

        return index === -1
            ? ""
            : normalized.slice(
                0,
                index
            );
    }

    function pathBase(
        path
    ) {
        return (
            normalizeTexture(
                path
            )
                .split("/")
                .pop() || ""
        );
    }

    function likelyBodyCandidates(
        headerPath
    ) {
        const normalized =
            normalizeTexture(
                headerPath
            );

        const dir =
            pathDirectory(
                normalized
            );

        const base =
            pathBase(
                normalized
            );

        const names =
            new Set();

        const add = (
            name
        ) => {
            if (
                !name ||
                name === base
            ) {
                return;
            }

            names.add(
                dir
                    ? `${dir}/${name}`
                    : name
            );
        };

        add(
            base.replace(
                /default_title_background/ig,
                "default_background"
            )
        );

        add(
            base.replace(
                /title_background/ig,
                "background"
            )
        );

        add(
            base.replace(
                /header_bar/ig,
                "panel_body"
            )
        );

        add(
            base.replace(
                /header/ig,
                "background"
            )
        );

        add(
            base.replace(
                /header/ig,
                "body"
            )
        );

        add(
            base.replace(
                /title/ig,
                "background"
            )
        );

        const prefix =
            base.split("_")[0];

        if (prefix) {
            add(
                `${prefix}_default_background`
            );
        }

        return [
            ...names,
        ];
    }

    async function detectBodyTexture(
        headerPath,
        mods
    ) {
        for (
            const candidate
            of likelyBodyCandidates(
                headerPath
            )
        ) {
            const existing =
                mods.index.images.get(
                    candidate
                );

            if (
                existing?.png &&
                !existing.__ragFallback
            ) {
                return normalizeTexture(
                    candidate
                );
            }

            const loaded =
                await ensureTexture(
                    candidate
                );

            if (
                loaded?.png &&
                !loaded.__ragFallback
            ) {
                return normalizeTexture(
                    candidate
                );
            }
        }

        const headerDir =
            pathDirectory(
                headerPath
            );

        const headerBase =
            pathBase(
                headerPath
            ).toLowerCase();

        let best =
            null;

        let bestScore =
            -1;

        for (
            const [path, state]
            of mods.index.images
        ) {
            if (
                !state?.png ||
                state.__ragFallback ||
                normalizeTexture(
                    path
                ) ===
                    normalizeTexture(
                        headerPath
                    )
            ) {
                continue;
            }

            const base =
                pathBase(
                    path
                ).toLowerCase();

            let score =
                0;

            if (
                pathDirectory(
                    path
                ) ===
                headerDir
            ) {
                score += 60;
            }

            if (
                /background/.test(
                    base
                )
            ) {
                score += 55;
            }

            if (
                /body/.test(
                    base
                )
            ) {
                score += 50;
            }

            if (
                /panel/.test(
                    base
                )
            ) {
                score += 25;
            }

            if (
                state.json
            ) {
                score += 15;
            }

            const prefix =
                headerBase
                    .split("_")[0];

            if (
                prefix &&
                base.startsWith(
                    prefix
                )
            ) {
                score += 25;
            }

            if (
                score >
                bestScore
            ) {
                bestScore =
                    score;

                best =
                    path;
            }
        }

        if (
            best &&
            bestScore >= 55
        ) {
            return normalizeTexture(
                best
            );
        }

        return null;
    }

    function autoRoleElement(
        host,
        role
    ) {
        return [
            ...host.children,
        ].find(
            (child) =>
                child instanceof
                    HTMLElement &&
                child.dataset
                    ?.ragAutoRole ===
                    role
        ) || null;
    }

    function autoRoleInstance(
        host,
        role,
        mods
    ) {
        const element =
            autoRoleElement(
                host,
                role
            );

        if (!element) {
            return null;
        }

        return mods.index
            .GLOBAL_ELEMENT_MAP
            .get(
                element.dataset.id
            ) || null;
    }

    async function createFixedDecorativeCanvas(
        parent,
        texturePath,
        role,
        mods,
        layer = 5
    ) {
        const state =
            await ensureTexture(
                texturePath
            );

        if (!state?.png) {
            return null;
        }

        const id =
            crypto.randomUUID?.()
                ?.replace(/-/g, "")
                .slice(0, 15) ||
            Math.random()
                .toString(36)
                .slice(2, 17);

        const canvas =
            new mods.DraggableCanvas(
                id,
                parent,
                state.png,
                texturePath,
                state.json
            );

        mods.index
            .GLOBAL_ELEMENT_MAP
            .set(
                id,
                canvas
            );

        const el =
            canvas.canvasHolder;

        el.dataset.ragFixedDecorative =
            "true";

        el.dataset.ragAutoRole =
            role;

        el.dataset.ragKeepAspect =
            "false";

        el.style.pointerEvents =
            "none";

        el.style.zIndex =
            String(layer);

        canvas.gridElement
            .style.pointerEvents =
            "none";

        canvas.resizeHandle
            .style.display =
            "none";

        return canvas;
    }

    function sizeCanvasRect(
        canvas,
        left,
        top,
        width,
        height
    ) {
        if (!canvas) return;

        const el =
            canvas.canvasHolder;

        el.style.left =
            `${left}px`;

        el.style.top =
            `${top}px`;

        canvas.drawImage(
            Math.max(
                1,
                width
            ),
            Math.max(
                1,
                height
            ),
            false
        );
    }

    function findAutoContentSlot(
        panel,
        mods
    ) {
        const host =
            panelMainElement(
                panel
            );

        if (!host) return null;

        for (
            const child
            of host.children
        ) {
            if (
                !(child instanceof
                    HTMLElement) ||
                child.dataset
                    ?.ragContentSlot !==
                    "true"
            ) {
                continue;
            }

            return mods.index
                .GLOBAL_ELEMENT_MAP
                .get(
                    child.dataset.id
                ) || null;
        }

        return null;
    }

    function syncFrameLines(
        panel,
        mods
    ) {
        const host =
            panelMainElement(
                panel
            );

        if (!host) return;

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

        const t =
            Math.max(
                4,
                Math.round(
                    Math.min(
                        width,
                        height
                    ) *
                    0.012
                )
            );

        const top =
            autoRoleInstance(
                host,
                "frame_top",
                mods
            );

        const bottom =
            autoRoleInstance(
                host,
                "frame_bottom",
                mods
            );

        const left =
            autoRoleInstance(
                host,
                "frame_left",
                mods
            );

        const right =
            autoRoleInstance(
                host,
                "frame_right",
                mods
            );

        sizeCanvasRect(
            top,
            0,
            0,
            width,
            t
        );

        sizeCanvasRect(
            bottom,
            0,
            height - t,
            width,
            t
        );

        sizeCanvasRect(
            left,
            0,
            t,
            t,
            height - t * 2
        );

        sizeCanvasRect(
            right,
            width - t,
            t,
            t,
            height - t * 2
        );
    }

    function syncContentFrameLines(
        slot,
        mods
    ) {
        const host =
            panelMainElement(
                slot
            );

        if (!host) return;

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

        const t =
            Math.max(
                3,
                Math.round(
                    Math.min(
                        width,
                        height
                    ) *
                    0.012
                )
            );

        sizeCanvasRect(
            autoRoleInstance(
                host,
                "content_top",
                mods
            ),
            0,
            0,
            width,
            t
        );

        sizeCanvasRect(
            autoRoleInstance(
                host,
                "content_bottom",
                mods
            ),
            0,
            height - t,
            width,
            t
        );

        sizeCanvasRect(
            autoRoleInstance(
                host,
                "content_left",
                mods
            ),
            0,
            t,
            t,
            height - t * 2
        );

        sizeCanvasRect(
            autoRoleInstance(
                host,
                "content_right",
                mods
            ),
            width - t,
            t,
            t,
            height - t * 2
        );

        const background =
            autoRoleInstance(
                host,
                "content_background",
                mods
            );

        if (background) {
            const inset =
                t * 2;

            sizeCanvasRect(
                background,
                inset,
                inset,
                Math.max(
                    1,
                    width -
                        inset * 2
                ),
                Math.max(
                    1,
                    height -
                        inset * 2
                )
            );
        }
    }

    function ensureChromeResizeObserver(
        mods
    ) {
        if (
            chromeResizeObserver ||
            !window.ResizeObserver
        ) {
            return;
        }

        chromeResizeObserver =
            new ResizeObserver(
                (
                    entries
                ) => {
                    for (
                        const entry
                        of entries
                    ) {
                        const host =
                            entry.target;

                        const id =
                            host.dataset
                                ?.id;

                        if (!id) {
                            continue;
                        }

                        const instance =
                            mods.index
                                .GLOBAL_ELEMENT_MAP
                                .get(id);

                        if (!instance) {
                            continue;
                        }

                        if (
                            host.dataset
                                .ragContentSlot ===
                            "true"
                        ) {
                            syncContentFrameLines(
                                instance,
                                mods
                            );
                        } else {
                            syncFrameLines(
                                instance,
                                mods
                            );
                        }
                    }
                }
            );
    }

    async function createOuterFrame(
        panel,
        mods
    ) {
        const host =
            panelMainElement(
                panel
            );

        if (!host) return;

        const linePath =
            ensureGeneratedLineTexture(
                mods
            );

        const roles = [
            "frame_top",
            "frame_bottom",
            "frame_left",
            "frame_right",
        ];

        for (
            const role
            of roles
        ) {
            if (
                autoRoleElement(
                    host,
                    role
                )
            ) {
                continue;
            }

            await createFixedDecorativeCanvas(
                host,
                linePath,
                role,
                mods,
                8
            );
        }

        ensureChromeResizeObserver(
            mods
        );

        chromeResizeObserver
            ?.observe(
                host
            );

        syncFrameLines(
            panel,
            mods
        );
    }

    async function createContentSlot(
        panel,
        bodyPath,
        mods
    ) {
        let slot =
            findAutoContentSlot(
                panel,
                mods
            );

        if (slot) {
            return slot;
        }

        const parent =
            panelMainElement(
                panel
            );

        const parentRect =
            parent.getBoundingClientRect();

        const id =
            crypto.randomUUID?.()
                ?.replace(/-/g, "")
                .slice(0, 15) ||
            Math.random()
                .toString(36)
                .slice(2, 17);

        slot =
            new mods.DraggablePanel(
                id,
                parent,
                true
            );

        mods.index
            .GLOBAL_ELEMENT_MAP
            .set(
                id,
                slot
            );

        const host =
            slot.panel;

        host.dataset.ragContentSlot =
            "true";

        host.dataset.ragClipsChildren =
            "true";

        host.style.overflow =
            "hidden";

        host.style.backgroundColor =
            "rgba(0,0,0,0)";

        host.style.zIndex =
            "20";

        const outerInset =
            Math.max(
                12,
                Math.round(
                    Math.min(
                        parentRect.width,
                        parentRect.height
                    ) *
                    0.035
                )
            );

        const headerSpace =
            Math.max(
                52,
                Math.min(
                    100,
                    parentRect.height *
                        0.18
                )
            );

        host.style.left =
            `${outerInset}px`;

        host.style.top =
            `${outerInset +
                headerSpace}px`;

        host.style.width =
            `${Math.max(
                80,
                parentRect.width -
                    outerInset * 2
            )}px`;

        host.style.height =
            `${Math.max(
                80,
                parentRect.height -
                    headerSpace -
                    outerInset * 2
            )}px`;

        const linePath =
            ensureGeneratedLineTexture(
                mods
            );

        for (
            const role
            of [
                "content_top",
                "content_bottom",
                "content_left",
                "content_right",
            ]
        ) {
            await createFixedDecorativeCanvas(
                host,
                linePath,
                role,
                mods,
                80
            );
        }

        if (bodyPath) {
            await createFixedDecorativeCanvas(
                host,
                bodyPath,
                "content_background",
                mods,
                0
            );
        }

        ensureChromeResizeObserver(
            mods
        );

        chromeResizeObserver
            ?.observe(
                host
            );

        syncContentFrameLines(
            slot,
            mods
        );

        return slot;
    }

    async function createAutoHeaderAndBorder(
        panel,
        mods
    ) {
        let headerPath;

        try {
            headerPath =
                await mods
                    .chooseImageModal();
        } catch (_) {
            return;
        }

        if (!headerPath) {
            return;
        }

        const headerState =
            await ensureTexture(
                headerPath
            );

        if (!headerState?.png) {
            showBanner(
                "Textura do header nao encontrada.",
                "error"
            );
            return;
        }

        const bodyPath =
            await detectBodyTexture(
                headerPath,
                mods
            );

        // 1) OUTER FRAME: four real strips, transparent center.
        await createOuterFrame(
            panel,
            mods
        );

        // 2) HEADER: editable independent child.
        const header =
            await createEditableHeader(
                panel,
                mods,
                headerPath
            );

        if (!header) return;

        const parent =
            panelMainElement(
                panel
            );

        const headerHost =
            headerMainElement(
                header
            );

        const parentRect =
            parent.getBoundingClientRect();

        const inset =
            Math.max(
                12,
                Math.round(
                    Math.min(
                        parentRect.width,
                        parentRect.height
                    ) *
                    0.035
                )
            );

        headerHost.style.left =
            `${inset}px`;

        headerHost.style.top =
            `${inset}px`;

        headerHost.style.width =
            `${Math.max(
                80,
                parentRect.width -
                    inset * 2
            )}px`;

        headerHost.style.height =
            `${Math.max(
                42,
                Math.min(
                    90,
                    parentRect.height *
                        0.13
                )
            )}px`;

        headerHost.style.zIndex =
            "100";

        syncHeaderBackground(
            header,
            mods
        );

        // 3) CONTENT SLOT: a real child panel exactly like the user's sketch.
        const slot =
            await createContentSlot(
                panel,
                bodyPath,
                mods
            );

        parent.dataset.ragAutoChrome =
            "true";

        parent.dataset.ragAutoHeaderTexture =
            normalizeTexture(
                headerPath
            );

        if (bodyPath) {
            parent.dataset.ragAutoBodyTexture =
                normalizeTexture(
                    bodyPath
                );
        }

        setPanelClipping(
            panel,
            true
        );

        mods.index.Builder
            .updateExplorer();

        // Select content slot after creation, because this is where normal
        // content should be added.
        if (slot) {
            try {
                slot.select(
                    new MouseEvent(
                        "dblclick",
                        {
                            bubbles: true,
                            cancelable: true,
                        }
                    )
                );
            } catch (_) {}
        }

        showBanner(
            bodyPath
                ? "Frame + header + content slot criados. Background relacionado detectado no slot."
                : "Frame + header + content slot criados.",
            "success"
        );
    }

    function patchCopyPasteAutoChrome(
        mods
    ) {
        // Metadata restoration keeps fixed frame/background roles.
        // Re-observe auto frame panels/content slots whenever properties refresh.
        ensureChromeResizeObserver(
            mods
        );
    }

    function installExpandedSidebar(
        mods
    ) {
        const addElements =
            document.querySelector(
                ".addElements"
            );

        if (
            !addElements ||
            addElements.querySelector(
                ".rag-v23-elements"
            )
        ) {
            return;
        }

        const group =
            document.createElement(
                "div"
            );

        group.className =
            "rag-v23-elements";

        const headerAuto =
            document.createElement(
                "button"
            );

        headerAuto.type =
            "button";

        headerAuto.textContent =
            "Add Header + Frame Auto";

        headerAuto.addEventListener(
            "click",
            async () => {
                const panel =
                    selectedPanelForChrome(
                        mods
                    );

                if (!panel) {
                    showBanner(
                        "Selecione um painel primeiro.",
                        "error"
                    );
                    return;
                }

                await createAutoHeaderAndBorder(
                    panel,
                    mods
                );
            }
        );

        const defs = [
            [
                "Add Text Field",
                "edit_box",
            ],
            [
                "Add Dropdown",
                "dropdown",
            ],
            [
                "Add Toggle",
                "toggle",
            ],
            [
                "Add Slider",
                "slider",
            ],
        ];

        group.appendChild(
            headerAuto
        );

        for (
            const [label, type]
            of defs
        ) {
            const button =
                document.createElement(
                    "button"
                );

            button.type =
                "button";

            button.textContent =
                label;

            button.addEventListener(
                "click",
                () => {
                    createDesignerControl(
                        type,
                        mods
                    );
                }
            );

            group.appendChild(
                button
            );
        }

        addElements.appendChild(
            group
        );
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
            ensureChromeResizeObserver(
                mods
            );

            chromeResizeObserver?.observe(
                panelMainElement(
                    panelInstance
                )
            );

            if (
                panelMainElement(
                    panelInstance
                )?.dataset
                    ?.ragContentSlot ===
                "true"
            ) {
                syncContentFrameLines(
                    panelInstance,
                    mods
                );
            } else {
                syncFrameLines(
                    panelInstance,
                    mods
                );
            }

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
                        : panelElement?.dataset
                            ?.ragContentSlot ===
                            "true"
                        ? "CONTENT SLOT"
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

                if (
                    panelElement?.dataset
                        ?.ragControlType
                ) {
                    appendControlPropertyTools(
                        panelBox,
                        panelInstance
                    );
                }

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
                    const autoHeader =
                        document.createElement(
                            "button"
                        );

                    autoHeader.type =
                        "button";

                    autoHeader.className =
                        "propertyInputButton rag-header-auto";

                    autoHeader.textContent =
                        "HEADER + FRAME AUTO";

                    autoHeader.addEventListener(
                        "click",
                        async () => {
                            autoHeader.disabled =
                                true;

                            try {
                                await createAutoHeaderAndBorder(
                                    panelInstance,
                                    mods
                                );
                            } finally {
                                autoHeader.disabled =
                                    false;
                            }
                        }
                    );

                    panelBox.appendChild(
                        autoHeader
                    );

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

                if (instance.nineSlice) {
                    const nativeBadge = document.createElement("span");
                    nativeBadge.className = "rag-native-sidecar-badge";
                    nativeBadge.textContent = " • SIDECAR NATIVO";
                    pathLabel.appendChild(nativeBadge);
                }
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

        if (instance.nineSlice) {
            const nativeBadge = document.createElement("span");
            nativeBadge.className = "rag-native-sidecar-badge";
            nativeBadge.textContent = " • SIDECAR NATIVO";
            pathLabel.appendChild(nativeBadge);
        }

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
    --rag-grid-line:
        rgba(255, 0, 255, .56);

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
        calc(100% / var(--grid-rows))
        !important;

    background-position:
        0 0 !important;

    opacity:
        .78;
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





/* Nested editor elements must stay above a panel's visual-only grid. */
.draggable-panel > .draggable-canvas,
.draggable-panel > .draggable-button,
.draggable-panel > .draggable-label,
.draggable-panel > .draggable-panel,
.draggable-panel > .draggable-collection_panel,
.draggable-collection_panel > .draggable-canvas,
.draggable-collection_panel > .draggable-button,
.draggable-collection_panel > .draggable-label,
.draggable-collection_panel > .draggable-panel,
.draggable-collection_panel > .draggable-collection_panel {
    pointer-events: auto;
}

[data-rag-clips-children="true"] {
    overflow: hidden !important;
}


.rag-copy-paste-tools {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
    width: 100%;
}

.rag-copy-paste-tools .utilElement {
    margin: 0;
    min-width: 0;
    font-weight: 900;
}

.rag-v23-elements {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px solid rgba(174,0,255,.35);
}

.rag-v23-elements > button {
    margin-left: 5px;
    margin-right: 5px;
    padding: 6px 10px;
    border-radius: 5px;
    border: none;
    outline: rgb(80,77,77) 1px solid;
    background: rgb(59,56,71);
    color: white;
    cursor: pointer;
}

.rag-v23-elements > button:first-child {
    background:
        linear-gradient(
            135deg,
            #52126f,
            #8c1b8c
        );
    font-weight: 900;
}


[data-rag-content-slot="true"] {
    background: rgba(0,0,0,.03);
}

[data-rag-auto-role^="frame_"],
[data-rag-auto-role^="content_"] {
    pointer-events: none !important;
}

[data-rag-auto-role="content_background"] {
    pointer-events: none !important;
}

.rag-header-auto {
    background:
        linear-gradient(
            135deg,
            #4d155e,
            #8f2468
        ) !important;
    font-weight: 900 !important;
}

.rag-control-preview {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    font-family: sans-serif;
    color: white;
    pointer-events: none;
    overflow: hidden;
}

.rag-control-edit_box {
    padding: 0 12px;
    border: 2px solid #64666d;
    background: rgba(26,27,31,.90);
    color: #aaa;
}

.rag-control-dropdown {
    justify-content: space-between;
    padding: 0 12px;
    border: 2px solid #63656b;
    background: rgba(43,44,49,.95);
}

.rag-dropdown-arrow {
    margin-left: 12px;
    font-size: .85em;
}

.rag-control-toggle {
    gap: 9px;
    padding: 0 8px;
    border: 1px solid rgba(110,110,120,.65);
    background: rgba(30,31,35,.78);
}

.rag-toggle-box {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #777a82;
    background: #202126;
    font-weight: 900;
}

.rag-control-slider {
    padding: 0 12px;
}

.rag-slider-track {
    position: relative;
    width: 100%;
    height: 8px;
    border-radius: 4px;
    background: #45474e;
}

.rag-slider-thumb {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 20px;
    height: 20px;
    transform: translate(-50%,-50%);
    border-radius: 50%;
    background: #9d3fcc;
    border: 2px solid #d8a6ef;
}

.rag-control-tools-title {
    margin-top: 9px;
    padding-top: 8px;
    border-top: 1px solid rgba(174,0,255,.35);
    color: #d69af1;
    font-size: 10px;
    font-weight: 900;
}

.rag-control-property-label {
    display: block;
    margin: 7px 5px 1px;
    color: #aaa;
    font-size: 9px;
    text-align: left;
}

.rag-control-check-row {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 8px 5px;
    color: #ddd;
    font-size: 10px;
}

[data-rag-panel-border-auto="true"] {
    pointer-events: none !important;
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

.rag-native-sidecar-badge {
    color: #8fe6a2;
    font-weight: 900;
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

        window.__RAG_LAST_MODS_V22__ =
            mods;

        patchClipsChildrenExport(mods);
        patchAdvancedControlExport(mods);
        patchGridSystem(mods);
        patchNestedPanelDrag(mods);
        patchCopyPasteMetadata(mods);
        patchCopyPasteAutoChrome(mods);

        installCopyPasteButtons(mods);
        installExpandedSidebar(mods);

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
