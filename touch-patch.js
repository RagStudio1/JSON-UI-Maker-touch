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
    window.__RAG_TOUCH_PATCH_BUILD__ = "v37-role-scoped-nine-slice";

    const BUILD = "v37-role-scoped-nine-slice";
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
    const explorerTouchStarts = new Map();

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
            import("./dist/ui/explorer/explorerController.js"),
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
            explorerMod,
        ]) => ({
            index,
            config: configMod.config,
            FormUploader: uploadMod.FormUploader,
            tagNameToCreateClassElementFunc:
                uploadMod.tagNameToCreateClassElementFunc,
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
            ExplorerController: explorerMod.ExplorerController,
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

    function explorerPointerDown(event) {
        if (!editMode || event.pointerType === "mouse") return;

        explorerTouchStarts.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
        });
    }

    function explorerPointerUp(event) {
        if (event.pointerType === "mouse") return;

        const start = explorerTouchStarts.get(event.pointerId);
        explorerTouchStarts.delete(event.pointerId);

        if (
            !editMode ||
            !(event.target instanceof Element) ||
            !start ||
            Math.hypot(
                event.clientX - start.x,
                event.clientY - start.y
            ) > 8
        ) {
            return;
        }

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

    function explorerPointerCancel(event) {
        explorerTouchStarts.delete(event.pointerId);
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

    // Keep the preview's native 2x2 center grid intact. The upstream editor
    // creates this grid independently from the Show Grid option; custom layer
    // setup must not clear its CSS variables.
    function installOriginalPreviewGrid(mods) {
        const restore = () => {
            const root = mods.config.rootElement;

            if (!(root instanceof HTMLElement) || !root.isConnected) return;

            const rootInstance = mods.index.GLOBAL_ELEMENT_MAP.get(
                root.dataset.id
            );

            const grid = rootInstance?.gridElement;
            if (!(grid instanceof HTMLElement)) return;

            grid.classList.remove("rag-grid-visible");
            grid.style.setProperty("--grid-cols", "2");
            grid.style.setProperty("--grid-rows", "2");
            grid.style.removeProperty("background-image");
            grid.style.removeProperty("background-position");
            grid.style.removeProperty("opacity");
        };

        restore();

        new MutationObserver(restore).observe(mainWindow, {
            childList: true,
            subtree: true,
        });
    }

    // Prevent an unrelated element from moving while another item is selected.
    // Selection still changes normally through dblclick/tap; only drag start is
    // rejected until the target becomes the active selection.
    function patchSelectedItemDragLock(mods) {
        const shared = mods.ElementSharedFuncs;

        if (!shared || shared.__ragSelectedDragLockV32) return;
        shared.__ragSelectedDragLockV32 = true;

        const originalStartDrag = shared.startDrag;
        let lastWarning = 0;

        shared.startDrag = function (event, classElement) {
            const selected = mods.index.selectedElement;
            const target = classElement?.getMainHTMLElement?.();

            if (
                selected instanceof HTMLElement &&
                selected.isConnected &&
                target instanceof HTMLElement &&
                selected !== target
            ) {
                classElement.isDragging = false;
                event?.preventDefault?.();
                event?.stopPropagation?.();

                queueMicrotask(() => {
                    if (classElement.centerCircle) {
                        classElement.centerCircle.style.display = "none";
                    }
                });

                if (Date.now() - lastWarning > 1200) {
                    lastWarning = Date.now();
                    showBanner(
                        "Selecione este item antes de mover.",
                        "normal"
                    );
                }

                return false;
            }

            return originalStartDrag.call(this, event, classElement);
        };
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

    function imageRoleSelect() {
        return document.querySelector(
            "#modalChooseImage .rag-image-role-select"
        );
    }

    function selectedImageRole() {
        return imageRoleSelect()?.value || "image";
    }

    function resetImageRole() {
        const select = imageRoleSelect();
        if (select) select.value = "image";
    }

    function newlyAddedCanvas(before, mods) {
        for (const [id, instance] of mods.index.GLOBAL_ELEMENT_MAP.entries()) {
            if (!before.has(id) && instance instanceof mods.DraggableCanvas) {
                return instance;
            }
        }

        return null;
    }

    function clearPreviousImageRole(parent, role, except, mods) {
        for (const child of parent.children) {
            if (
                child === except ||
                !(child instanceof HTMLElement) ||
                child.dataset.ragBorderSystemRole !== role
            ) {
                continue;
            }

            delete child.dataset.ragBorderSystemRole;
            delete child.dataset.ragBorderBackground;
            delete child.dataset.ragBackgroundInitialized;
            delete child.dataset.ragImportedImageRole;
            delete child.dataset.ragFixedDecorative;
            child.dataset.ragExplorerName = "IMAGE";
            child.style.pointerEvents = "auto";
            child.style.zIndex = "30";

            const old = mods.index.GLOBAL_ELEMENT_MAP.get(child.dataset.id);
            old?.gridElement?.style.setProperty("pointer-events", "auto");
            if (old?.resizeHandle) old.resizeHandle.style.display = "block";
            old?.setEditable?.(true);
        }
    }

    function fitRoleImageToParent(instance) {
        const parentRect = instance.container.getBoundingClientRect();
        const width =
            parseFloat(instance.container.style.width) ||
            parentRect.width ||
            1;
        const height =
            parseFloat(instance.container.style.height) ||
            parentRect.height ||
            1;

        instance.canvasHolder.style.left = "0px";
        instance.canvasHolder.style.top = "0px";
        instance.canvasHolder.dataset.ragKeepAspect = "false";
        instance.drawImage(width, height, false);
        instance.aspectRatio = width / Math.max(1, height);
    }

    function keepPanelContentAboveBackground(parent, background) {
        for (const child of parent.children) {
            if (
                child === background ||
                !(child instanceof HTMLElement) ||
                child.dataset.skip === "true" ||
                child.dataset.ragBorderSystemRole === "border" ||
                child.dataset.ragHeader === "true"
            ) {
                continue;
            }

            const layer = Number(child.style.zIndex);
            if (!Number.isFinite(layer) || layer <= 10) {
                child.style.zIndex = "20";
            }
        }
    }

    function applyImportedImageRole(instance, role, mods) {
        if (!instance) return;

        const element = instance.canvasHolder;
        const parent = instance.container;

        if (instance.nineSlice?.__ragAutoGenerated) {
            const box = currentBox(instance);
            instance.nineSlice = undefined;
            instance.drawImage(box.width, box.height, false);
            element.style.left = box.left;
            element.style.top = box.top;
        }

        if (role === "image") {
            const previousRole = element.dataset.ragBorderSystemRole;
            delete element.dataset.ragBorderSystemRole;
            delete element.dataset.ragImportedImageRole;
            delete element.dataset.ragBorderBackground;
            delete element.dataset.ragBackgroundInitialized;
            delete element.dataset.ragFixedDecorative;
            element.dataset.ragExplorerName = "IMAGE";
            element.style.pointerEvents = "auto";
            instance.gridElement.style.pointerEvents = "auto";
            instance.resizeHandle.style.display = "block";
            instance.setEditable?.(true);

            if (previousRole === "background" || previousRole === "border") {
                element.style.zIndex = "30";
            }

            mods.index.Builder.updateExplorer();
            mods.updatePropertiesArea();
            return;
        }

        clearPreviousImageRole(parent, role, element, mods);
        fitRoleImageToParent(instance);

        element.dataset.ragBorderSystemRole = role;
        element.dataset.ragImportedImageRole = role;

        if (role === "background") {
            element.dataset.ragBorderBackground = "true";
            element.dataset.ragBackgroundInitialized = "true";
            element.dataset.ragExplorerName = "BACKGROUND";
            delete element.dataset.ragFixedDecorative;
            element.style.zIndex = "10";
            element.style.pointerEvents = "auto";
            instance.gridElement.style.pointerEvents = "auto";
            instance.resizeHandle.style.display = "block";
            instance.setEditable?.(true);
            keepPanelContentAboveBackground(parent, element);
        } else if (role === "border") {
            element.dataset.ragExplorerName = "BORDER";
            element.dataset.ragFixedDecorative = "true";
            element.style.zIndex = "60";
            element.style.pointerEvents = "none";
            instance.gridElement.style.pointerEvents = "none";
            instance.resizeHandle.style.display = "none";
            instance.setEditable?.(false);
        }

        mods.index.Builder.updateExplorer();
        mods.updatePropertiesArea();
    }

    async function createImportedHeader(texturePath, mods) {
        const panel = selectedPanelForChrome(mods);

        if (!panel) {
            showBanner(
                "Selecione um painel antes de adicionar um header.",
                "error"
            );
            return null;
        }

        const header = await createEditableHeader(panel, mods, texturePath);

        if (header) {
            showBanner(
                "Imagem adicionada como HEADER editavel.",
                "success"
            );
        }


        return header;
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
            resetImageRole();

            try {
                return await oldOpen.apply(this, args);
            } finally {
                imageParentLock = previous;
            }
        };

        Builder.addCanvas = function (...args) {
            restoreImageParent();

            const selectedRole = selectedImageRole();
            const role =
                selectedRole === "button_texture"
                    ? "image"
                    : selectedRole;

            const texturePath = normalizeTexture(args[1]);
            const textureState = mods.index.images.get(texturePath);
            migrateAutomaticNineSlice(texturePath, textureState);

            if (args[2]?.__ragAutoGenerated) {
                args[2] = undefined;
            }

            if (role === "header") {
                resetImageRole();
                void createImportedHeader(texturePath, mods);
                return;
            }

            const before = new Set(
                mods.index.GLOBAL_ELEMENT_MAP.keys()
            );

            // V21:
            // Keep the native sidecar passed by the original editor.
            // The custom 9-slice EDITOR stays removed, but rendering support
            // is necessary for backgrounds/buttons that already depend on it.
            const result = oldAdd.apply(this, args);
            const added = newlyAddedCanvas(before, mods);

            applyImportedImageRole(added, role, mods);

            if (role !== "image" && added) {
                showBanner(
                    role === "background"
                        ? "Imagem adicionada como BACKGROUND do painel."
                        : "Imagem adicionada como BORDA fixa do painel.",
                    "success"
                );
            }

            resetImageRole();
            return result;
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

    function persistImage(key, file, dataUrl, nineSlice = null) {
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

            if (nineSlice) {
                localStorage.setItem(
                    `asset_${key}_json`,
                    JSON.stringify({
                        jsonContent: nineSlice,
                        metadata: {
                            name: `${cleanImageName(file.name)}.json`,
                            relativePath: `textures/${key}.json`,
                            importedFromFiles: true,
                        },
                    })
                );
            }
        } catch (_) {}
    }

    function validNineSlice(value) {
        return Boolean(
            value &&
            typeof value === "object" &&
            value.nineslice_size !== undefined &&
            value.base_size !== undefined
        );
    }

    function autoButtonNineSlice(imageData) {
        const width = Math.max(3, imageData.width || 3);
        const height = Math.max(3, imageData.height || 3);
        const maxX = Math.max(1, Math.floor((width - 1) / 2));
        const maxY = Math.max(1, Math.floor((height - 1) / 2));
        const left = Math.min(maxX, 12, Math.max(1, Math.round(width / 3)));
        const right = left;
        const top = Math.min(maxY, 12, Math.max(1, Math.round(height / 3)));
        const bottom = Math.min(
            Math.max(1, height - top - 1),
            15,
            Math.max(1, Math.round(height * 5 / 12))
        );

        return {
            nineslice_size: [left, top, right, bottom],
            base_size: [imageData.width, imageData.height],
            __ragAutoGenerated: true,
        };
    }

    function migrateAutomaticNineSlice(path, state) {
        if (!state?.json?.__ragAutoGenerated) return state;

        state.__ragButtonNineSlice = state.json;
        delete state.json;

        try {
            localStorage.removeItem(
                `asset_${normalizeTexture(path)}_json`
            );
        } catch (_) {}

        return state;
    }

    function buttonTextureImportContext() {
        const addButton = document.getElementById("modalAddButton");
        const buttonModalOpen =
            addButton &&
            getComputedStyle(addButton).display !== "none";

        return (
            selectedImageRole() === "button_texture" ||
            buttonModalOpen
        );
    }

    function parseSidecarFile(file) {
        if (!file) return Promise.resolve(null);

        return file.text().then((text) => {
            const parsed = JSON.parse(text);
            if (!validNineSlice(parsed)) {
                throw new Error("JSON sidecar sem nineslice_size/base_size.");
            }
            return parsed;
        });
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

    async function importChosenFile(wrapper, file, sidecarFile = null) {
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
        const [imageData, dataUrl, sidecar] = await Promise.all([
            fileImageData(file),
            fileDataUrl(file),
            parseSidecarFile(sidecarFile),
        ]);

        const automaticButtonNineSlice =
            !sidecar && buttonTextureImportContext()
                ? autoButtonNineSlice(imageData)
                : null;

        const key = uniqueImageKey(mods.index.images, file.name);

        mods.index.images.set(key, {
            png: imageData,
            // A real user-provided sidecar belongs to the texture. An
            // automatically generated button sidecar belongs only to button
            // rendering and must never leak into backgrounds or headers.
            json: sidecar || undefined,
            __ragButtonNineSlice: automaticButtonNineSlice || undefined,
        });

        persistImage(key, file, dataUrl, sidecar);

        status.textContent =
            `Importada: ${file.name}` +
            (sidecar
                ? " • 9-SLICE DO JSON"
                : automaticButtonNineSlice
                ? " • 9-SLICE SOMENTE NO BOTAO"
                : "");
        status.dataset.kind = "success";

        const form =
            document.querySelector(
                "#modalChooseImage .modalChooseImageForm"
            );

        if (form) chooseImportedImage(form, key);
    }

    async function importChosenFiles(wrapper, fileList) {
        const files = [...(fileList || [])];
        const images = files.filter((file) =>
            /\.(png|jpe?g|webp)$/i.test(file.name || "") ||
            /^image\/(png|jpeg|webp)$/i.test(file.type || "")
        );

        if (!images.length) {
            throw new Error("Selecione pelo menos uma imagem PNG/JPG/WEBP.");
        }

        // The chooser consumes one texture at a time. Supporting multiple
        // selection here is for a PNG + matching JSON sidecar pair.
        const image = images[0];
        const stem = image.name.replace(/\.[^.]+$/, "").toLowerCase();
        const sidecar = files.find(
            (file) =>
                file.name.toLowerCase() === `${stem}.json`
        );

        await importChosenFile(wrapper, image, sidecar || null);
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

        const builtinNote =
            document.createElement(
                "div"
            );

        builtinNote.className =
            "rag-builtin-assets-note";

        builtinNote.textContent =
            "NORDIC BUILT-IN: border + lime header + lime background disponiveis em ui/nordic";

        content.insertBefore(
            builtinNote,
            form
        );

        const wrapper = document.createElement("div");
        wrapper.className = "rag-file-picker";

        const roleBox = document.createElement("label");
        roleBox.className = "rag-image-role-box";

        const roleTitle = document.createElement("span");
        roleTitle.textContent = "USAR ESTA IMAGEM COMO:";

        const roleSelect = document.createElement("select");
        roleSelect.className = "rag-image-role-select";

        for (const [value, label] of [
            ["image", "Imagem normal / icone"],
            ["button_texture", "Textura de botao (9-slice)"],
            ["background", "Background do painel"],
            ["border", "Borda / frame do painel"],
            ["header", "Header editavel do painel"],
        ]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            roleSelect.appendChild(option);
        }

        const roleHelp = document.createElement("small");
        roleHelp.textContent =
            "Para botoes, selecione PNG + JSON juntos ou use o 9-slice automatico.";

        roleBox.append(roleTitle, roleSelect, roleHelp);

        const filesButton = document.createElement("button");
        filesButton.type = "button";
        filesButton.textContent = "ESCOLHER ARQUIVO";

        const filesInput = document.createElement("input");
        filesInput.type = "file";
        filesInput.multiple = true;
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
            if (!filesInput.files?.length) return;

            try {
                await importChosenFiles(wrapper, filesInput.files);
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
            roleBox,
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

                decorateMissingTexture(this, path, state);
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
    // Compound buttons: sane initial size + correctly centred label
    // ============================================================

    function buttonLabelIsCentered(instance, tolerance = 8) {
        const label = instance?.displayText?.label;
        if (!label) return false;

        const buttonWidth =
            parseFloat(instance.button.style.width) ||
            instance.button.getBoundingClientRect().width;
        const buttonHeight =
            parseFloat(instance.button.style.height) ||
            instance.button.getBoundingClientRect().height;
        const labelWidth =
            parseFloat(label.style.width) ||
            label.getBoundingClientRect().width;
        const labelHeight =
            parseFloat(label.style.height) ||
            label.getBoundingClientRect().height;
        const left = parseFloat(label.style.left) || 0;
        const top = parseFloat(label.style.top) || 0;

        return (
            Math.abs(left - (buttonWidth - labelWidth) / 2) <= tolerance &&
            Math.abs(top - (buttonHeight - labelHeight) / 2) <= tolerance
        );
    }

    function centerButtonLabel(instance) {
        const labelInstance = instance?.displayText;
        const label = labelInstance?.label;
        if (!label) return;

        labelInstance.updateSize(false);

        const buttonWidth =
            parseFloat(instance.button.style.width) ||
            instance.button.getBoundingClientRect().width;
        const buttonHeight =
            parseFloat(instance.button.style.height) ||
            instance.button.getBoundingClientRect().height;
        const labelWidth =
            parseFloat(label.style.width) ||
            label.getBoundingClientRect().width;
        const labelHeight =
            parseFloat(label.style.height) ||
            label.getBoundingClientRect().height;

        label.style.left = `${(buttonWidth - labelWidth) / 2}px`;
        label.style.top = `${(buttonHeight - labelHeight) / 2}px`;
        labelInstance.updateSize(false);
    }

    function patchCompoundButtons(mods) {
        const Button = mods.DraggableButton;
        if (Button.prototype.__ragV34CompoundButton) return;
        Button.prototype.__ragV34CompoundButton = true;

        // v36 incorrectly stored automatic button 9-slice as a global texture
        // sidecar. Migrate those entries back to button-only metadata so the
        // same PNG renders normally as a background or header.
        for (const [path, state] of mods.index.images.entries()) {
            migrateAutomaticNineSlice(path, state);
        }

        const originalDrawImage = Button.prototype.drawImage;
        const originalSetDisplayText = Button.prototype.setDisplayText;

        Button.prototype.drawImage = function (
            width,
            height,
            imageDataState = this.imageDataDefault,
            updateImage = false
        ) {
            if (!imageDataState?.json && imageDataState?.png) {
                let texturePath = "";

                if (imageDataState === this.imageDataDefault) {
                    texturePath = this.button?.dataset?.defaultImagePath || "";
                } else if (imageDataState === this.imageDataHover) {
                    texturePath = this.button?.dataset?.hoverImagePath || "";
                } else if (imageDataState === this.imageDataPressed) {
                    texturePath = this.button?.dataset?.pressedImagePath || "";
                }

                // Files imported by the mobile/gallery picker have no JSON
                // sidecar. When one is actually used as a button state, make
                // it behave like the project's native button assets, but keep
                // that metadata private to this button instance.
                if (normalizeTexture(texturePath).startsWith("gallery/")) {
                    const buttonState = {
                        ...imageDataState,
                        json:
                            imageDataState.__ragButtonNineSlice ||
                            autoButtonNineSlice(imageDataState.png),
                    };

                    if (imageDataState === this.imageDataDefault) {
                        this.imageDataDefault = buttonState;
                    }
                    if (imageDataState === this.imageDataHover) {
                        this.imageDataHover = buttonState;
                    }
                    if (imageDataState === this.imageDataPressed) {
                        this.imageDataPressed = buttonState;
                    }

                    imageDataState = buttonState;
                }
            }

            const keepLabelCentered =
                this.button?.dataset?.ragAutoCenterLabel === "true" ||
                buttonLabelIsCentered(this);

            // The upstream constructor enlarges every texture to 80% of its
            // parent. Small button PNGs therefore become enormous. Keep their
            // intrinsic size and only shrink when they do not fit.
            if (updateImage && imageDataState?.png) {
                const imageWidth = Math.max(1, imageDataState.png.width || 1);
                const imageHeight = Math.max(1, imageDataState.png.height || 1);
                const scale = Math.min(
                    1,
                    Math.max(1, width) / imageWidth,
                    Math.max(1, height) / imageHeight
                );

                width = imageWidth * scale;
                height = imageHeight * scale;
                updateImage = false;
            }

            const result = originalDrawImage.call(
                this,
                Math.max(1, width),
                Math.max(1, height),
                imageDataState,
                updateImage
            );

            if (keepLabelCentered) centerButtonLabel(this);
            return result;
        };

        Button.prototype.setDisplayText = function (text) {
            const result = originalSetDisplayText.call(this, text);
            const autoCenter = !window.__RAG_NATIVE_BUTTON_IMPORT__;

            this.button.dataset.ragAutoCenterLabel = String(autoCenter);

            if (autoCenter) {
                centerButtonLabel(this);
                requestAnimationFrame(() => centerButtonLabel(this));
                document.fonts?.ready?.then(() => {
                    if (this.button.dataset.ragAutoCenterLabel === "true") {
                        centerButtonLabel(this);
                    }
                });
            }

            const label = this.displayText?.label;
            if (label && !label.dataset.ragCenterWatch) {
                label.dataset.ragCenterWatch = "true";
                let start = null;

                label.addEventListener("mousedown", () => {
                    start = {
                        left: label.style.left,
                        top: label.style.top,
                    };
                });

                document.addEventListener("mouseup", () => {
                    if (!start) return;

                    if (
                        label.style.left !== start.left ||
                        label.style.top !== start.top
                    ) {
                        this.button.dataset.ragAutoCenterLabel = "false";
                    }

                    start = null;
                });
            }

            return result;
        };
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

    function fallbackKind(path) {
        const value = normalizeTexture(path).toLowerCase();

        if (/(background|(^|[\/_-])bg([\/_-]|$))/.test(value)) return "BG";
        if (/(border|frame)/.test(value)) return "BORDER";
        if (/(button|btn)/.test(value)) return "BUTTON";
        if (/(skin|portrait|avatar|doll)/.test(value)) return "SKIN";
        if (/(icon|glyph|symbol)/.test(value)) return "ICON";
        return "TEXTURE";
    }

    function fallbackHue(path) {
        let hash = 2166136261;

        for (const character of normalizeTexture(path)) {
            hash ^= character.charCodeAt(0);
            hash = Math.imul(hash, 16777619);
        }

        return Math.abs(hash) % 360;
    }

    function makeFallbackImageData(label) {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;

        const ctx = canvas.getContext("2d", {
            willReadFrequently: true,
        });

        const path = normalizeTexture(label);
        const name = baseName(path) || "unknown_texture";
        const kind = fallbackKind(path);
        const hue = fallbackHue(path);

        ctx.fillStyle = `hsl(${hue} 26% 15%)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = `hsla(${hue} 68% 62% / .18)`;
        ctx.lineWidth = 12;

        for (let x = -180; x < 500; x += 46) {
            ctx.beginPath();
            ctx.moveTo(x, 180);
            ctx.lineTo(x + 180, 0);
            ctx.stroke();
        }

        ctx.strokeStyle = `hsl(${hue} 75% 68%)`;
        ctx.lineWidth = 5;
        ctx.setLineDash([14, 9]);
        ctx.strokeRect(5, 5, 310, 170);
        ctx.setLineDash([]);

        ctx.fillStyle = `hsl(${hue} 55% 32%)`;
        ctx.fillRect(18, 18, 92, 52);

        ctx.fillStyle = "#fff";
        ctx.font = "900 21px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(kind, 29, 51, 72);

        ctx.fillStyle = "rgba(0, 0, 0, .72)";
        ctx.fillRect(18, 84, 284, 76);

        ctx.fillStyle = "#ffcf66";
        ctx.font = "900 17px sans-serif";
        ctx.fillText("MISSING TEXTURE", 30, 110, 260);

        ctx.fillStyle = "#fff";
        ctx.font = "700 15px monospace";
        ctx.fillText(name.slice(0, 28), 30, 136, 260);

        ctx.fillStyle = "rgba(255, 255, 255, .68)";
        ctx.font = "11px monospace";
        ctx.fillText(path.slice(0, 43), 30, 153, 260);

        return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    function decorateMissingTexture(instance, requested, state) {
        const holder = instance?.canvasHolder || instance?.button;
        if (!(holder instanceof HTMLElement)) return;

        holder
            .querySelector(":scope > .rag-missing-texture-label")
            ?.remove();

        const missing = Boolean(state?.__ragFallback);
        holder.dataset.ragFallbackActive = String(missing);
        holder.dataset.ragRequestedTexture = normalizeTexture(requested);

        if (!missing) return;

        const label = document.createElement("div");
        label.className = "rag-missing-texture-label";
        label.dataset.skip = "true";
        label.title = `Textura ausente: textures/${normalizeTexture(requested)}`;

        const kind = document.createElement("b");
        kind.textContent = `${fallbackKind(requested)} AUSENTE`;

        const path = document.createElement("span");
        path.textContent = normalizeTexture(requested);

        label.append(kind, path);
        holder.appendChild(label);
    }

    function updateMissingTexturePanel() {
        let panel = document.querySelector(".rag-missing-textures-panel");
        const paths = [...universalState.missingPaths].sort();

        if (!paths.length) {
            panel?.remove();
            return;
        }

        if (!panel) {
            panel = document.createElement("details");
            panel.className = "rag-missing-textures-panel";
            document.body.appendChild(panel);
        }

        panel.innerHTML = "";

        const summary = document.createElement("summary");
        summary.textContent = `TEXTURAS AUSENTES: ${paths.length}`;

        const intro = document.createElement("div");
        intro.className = "rag-missing-textures-intro";
        intro.textContent = "Importe estas texturas mantendo os mesmos caminhos:";

        const list = document.createElement("div");
        list.className = "rag-missing-textures-list";

        for (const path of paths) {
            const row = document.createElement("code");
            row.textContent = `textures/${path}.png`;
            list.appendChild(row);
        }

        panel.append(summary, intro, list);
    }

    function scheduleMissingTexturePanelUpdate() {
        if (scheduleMissingTexturePanelUpdate.pending) return;
        scheduleMissingTexturePanelUpdate.pending = true;

        queueMicrotask(() => {
            scheduleMissingTexturePanelUpdate.pending = false;
            updateMissingTexturePanel();
        });
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

        const exact = migrateAutomaticNineSlice(
            requested,
            images.get(requested)
        );

        if (exact?.png && !exact.__ragFallback) {
            universalState.missingPaths.delete(requested);
            scheduleMissingTexturePanelUpdate();
            return exact;
        }

        const loaded = findLoadedByBasename(
            images,
            requested
        );

        if (loaded) {
            migrateAutomaticNineSlice(requested, loaded);
            images.set(requested, loaded);
            universalState.missingPaths.delete(requested);
            scheduleMissingTexturePanelUpdate();
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
                scheduleMissingTexturePanelUpdate();
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
        scheduleMissingTexturePanelUpdate();

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

        updateMissingTexturePanel();
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

    function expandedExternalControl(rawKey, rawValue) {
        const { ref } = splitControlKey(rawKey);
        const local =
            rawValue && typeof rawValue === "object"
                ? rawValue
                : {};

        if (!ref) return local;

        const base = localDefinition(ref);
        return base ? merge(base, local) : local;
    }

    function firstExternalTexture(value, vars, depth = 0) {
        if (!value || typeof value !== "object" || depth > 8) return "";

        const localVars = variables(value, vars);
        const candidates = [
            value.texture,
            value.$button_texture,
            value.$default_button_texture,
            value.$default_button_background_texture,
        ];

        for (const candidate of candidates) {
            const resolved = resolveVariable(candidate, localVars);
            if (typeof resolved === "string" && resolved && !resolved.startsWith("#")) {
                return normalizeTexture(resolved);
            }
        }

        for (const entry of value.controls || []) {
            for (const [key, child] of Object.entries(entry || {})) {
                const found = firstExternalTexture(
                    expandedExternalControl(key, child),
                    localVars,
                    depth + 1
                );
                if (found) return found;
            }
        }

        return "";
    }

    function externalButtonTexture(json, vars, state) {
        const directKeys =
            state === "default"
                ? [
                    "$default_button_background_texture",
                    "$default_button_texture",
                    "$button_texture",
                    "texture",
                ]
                : state === "hover"
                ? [
                    "$hover_button_background_texture",
                    "$hover_button_texture",
                ]
                : [
                    "$pressed_button_background_texture",
                    "$pressed_button_texture",
                ];

        for (const key of directKeys) {
            const resolved = resolveVariable(json[key], vars);
            if (typeof resolved === "string" && resolved && !resolved.startsWith("#")) {
                return normalizeTexture(resolved);
            }
        }

        const configuredName = resolveVariable(
            json[`${state}_control`],
            vars
        );

        for (const entry of json.controls || []) {
            for (const [key, child] of Object.entries(entry || {})) {
                const { name } = splitControlKey(key);
                const lower = name.toLowerCase();
                const matches =
                    (configuredName && name === configuredName) ||
                    (state === "default" && /default|normal|idle/.test(lower)) ||
                    (state === "hover" && /hover|focused/.test(lower)) ||
                    (state === "pressed" && /press|clicked/.test(lower));

                if (!matches) continue;

                const found = firstExternalTexture(
                    expandedExternalControl(key, child),
                    vars
                );
                if (found) return found;
            }
        }

        return "";
    }

    function externalButtonText(json, vars) {
        const value = resolveVariable(
            json.$button_text ?? json.text,
            vars
        );

        return (
            typeof value === "string" &&
            value &&
            !value.startsWith("#")
        )
            ? value
            : "Label";
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

        if (type === "button") {
            const requestedDefault =
                externalButtonTexture(json, vars, "default") ||
                "assets/placeholder";
            const requestedHover =
                externalButtonTexture(json, vars, "hover") ||
                requestedDefault;
            const requestedPressed =
                externalButtonTexture(json, vars, "pressed") ||
                requestedHover;

            const [defaultState, hoverState, pressedState] =
                await Promise.all([
                    ensureTexture(requestedDefault),
                    ensureTexture(requestedHover),
                    ensureTexture(requestedPressed),
                ]);

            const id = newId();
            instance = new mods.DraggableButton(id, parent, {
                buttonText: externalButtonText(json, vars),
                defaultTexture: requestedDefault,
                hoverTexture: requestedHover,
                pressedTexture: requestedPressed,
                collectionIndex: String(
                    resolveVariable(json.collection_index, vars) ?? "0"
                ),
            });

            mods.index.GLOBAL_ELEMENT_MAP.set(id, instance);

            const box = geometry(
                instance.button,
                json,
                vars,
                parent,
                mods,
                [100, 40]
            );

            instance.drawImage(box.width, box.height, defaultState);
            instance.imageDataDefault = defaultState;
            instance.imageDataHover = hoverState;
            instance.imageDataPressed = pressedState;
            instance.button.dataset.defaultImagePath = requestedDefault;
            instance.button.dataset.hoverImagePath = requestedHover;
            instance.button.dataset.pressedImagePath = requestedPressed;
            instance.button.dataset.ragCompoundButton = "true";
            instance.bindings = bindingsString(json);
            centerButtonLabel(instance);

            decorateMissingTexture(instance, requestedDefault, defaultState);
        } else if (type === "image") {
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
            decorateMissingTexture(instance, requested, state);
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
            // A button is one compound editor item. Importing its state trees
            // as normal children creates duplicate backgrounds, labels and
            // independent resize handles.
            controls = [];
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

        universalState.missingPaths.clear();
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

    // Smart alignment between elements that share the same parent panel.
    // This is deliberately separate from Grid Lock: Grid Lock snaps to fixed
    // cells, while Panel Lock snaps to sibling and parent edges/centers.
    function patchPanelLock(mods) {
        const shared = mods.ElementSharedFuncs;

        if (!shared || shared.__ragPanelLockV30) return;
        shared.__ragPanelLockV30 = true;

        if (!mods.config.settings.panel_lock) {
            mods.config.settings.panel_lock = {
                type: "checkbox",
                editable: true,
                value: false,
                displayName: "Panel Lock (Smart Align)",
            };
        }

        if (!mods.config.settings.panel_lock_radius) {
            mods.config.settings.panel_lock_radius = {
                type: "number",
                editable: true,
                value: 12,
                displayName: "Panel Lock Radius",
            };
        }

        const activeGuides = [];

        const clearGuides = () => {
            while (activeGuides.length) {
                activeGuides.pop()?.remove();
            }
        };

        const addGuide = (parent, axis, position) => {
            const guide = document.createElement("div");
            guide.className = `rag-panel-lock-guide rag-panel-lock-${axis}`;
            guide.dataset.axis = axis.toUpperCase();

            if (axis === "x") {
                guide.style.left = `${position}px`;
            } else {
                guide.style.top = `${position}px`;
            }

            parent.appendChild(guide);
            activeGuides.push(guide);
        };

        const nearest = (current, candidates, radius) => {
            let match = null;

            for (const candidate of candidates) {
                const distance = Math.abs(candidate.value - current);

                if (distance <= radius && (!match || distance < match.distance)) {
                    match = {
                        ...candidate,
                        distance,
                    };
                }
            }

            return match;
        };

        const originalDrag = shared.drag;

        shared.drag = function (event, classElement, mainElement) {
            const result = originalDrag.call(
                this,
                event,
                classElement,
                mainElement
            );

            clearGuides();

            if (
                !mods.config.settings.panel_lock.value ||
                !classElement?.isDragging ||
                classElement?.isResizing
            ) {
                return result;
            }

            const element =
                mainElement || classElement?.getMainHTMLElement?.();
            const parent = classElement?.container;

            if (!(element instanceof HTMLElement) || !(parent instanceof HTMLElement)) {
                return result;
            }

            const width = element.offsetWidth || element.getBoundingClientRect().width;
            const height = element.offsetHeight || element.getBoundingClientRect().height;
            const parentWidth = parent.clientWidth || parent.getBoundingClientRect().width;
            const parentHeight = parent.clientHeight || parent.getBoundingClientRect().height;
            const left = parseFloat(element.style.left) || 0;
            const top = parseFloat(element.style.top) || 0;
            const radius = Math.max(
                1,
                Number(mods.config.settings.panel_lock_radius.value) || 12
            );

            const xCandidates = [
                { value: 0, guide: 0 },
                { value: (parentWidth - width) / 2, guide: parentWidth / 2 },
                { value: parentWidth - width, guide: parentWidth },
            ];
            const yCandidates = [
                { value: 0, guide: 0 },
                { value: (parentHeight - height) / 2, guide: parentHeight / 2 },
                { value: parentHeight - height, guide: parentHeight },
            ];

            for (const instance of mods.index.GLOBAL_ELEMENT_MAP.values()) {
                if (instance === classElement || instance?.container !== parent) continue;

                const sibling = instance?.getMainHTMLElement?.();
                if (!(sibling instanceof HTMLElement) || sibling === element) continue;
                if (sibling.style.visibility === "hidden" || sibling.dataset.ragFixedDecorative === "true") continue;

                const siblingLeft = parseFloat(sibling.style.left) || 0;
                const siblingTop = parseFloat(sibling.style.top) || 0;
                const siblingWidth = sibling.offsetWidth || sibling.getBoundingClientRect().width;
                const siblingHeight = sibling.offsetHeight || sibling.getBoundingClientRect().height;

                xCandidates.push(
                    { value: siblingLeft, guide: siblingLeft },
                    {
                        value: siblingLeft + (siblingWidth - width) / 2,
                        guide: siblingLeft + siblingWidth / 2,
                    },
                    {
                        value: siblingLeft + siblingWidth - width,
                        guide: siblingLeft + siblingWidth,
                    }
                );

                yCandidates.push(
                    { value: siblingTop, guide: siblingTop },
                    {
                        value: siblingTop + (siblingHeight - height) / 2,
                        guide: siblingTop + siblingHeight / 2,
                    },
                    {
                        value: siblingTop + siblingHeight - height,
                        guide: siblingTop + siblingHeight,
                    }
                );
            }

            const xMatch = nearest(left, xCandidates, radius);
            const yMatch = nearest(top, yCandidates, radius);

            if (xMatch) {
                element.style.left = `${xMatch.value}px`;
                addGuide(parent, "x", xMatch.guide);
            }

            if (yMatch) {
                element.style.top = `${yMatch.value}px`;
                addGuide(parent, "y", yMatch.guide);
            }

            return result;
        };

        const originalStopDrag = shared.stopDrag;

        shared.stopDrag = function (...args) {
            const result = originalStopDrag.apply(this, args);
            clearGuides();
            return result;
        };

        window.__RAG_PANEL_LOCK__ = {
            clearGuides,
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

        host.dataset.ragExplorerName =
            "HEADER";

        host.classList.add(
            "rag-header-panel"
        );

        // Header must always render ABOVE the border.
        host.style.zIndex =
            "120";

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
            .ragExplorerName =
            "HEADER TEXTURE";

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
    // V26: BUILT-IN NORDIC ASSETS
    // Exact assets extracted from NORDIC_COSMETICS_RP_v4.9.14.
    // They are registered in images + GLOBAL_FILE_SYSTEM automatically.
    // ============================================================

    const NORDIC_BUILTIN_PNG = {"ui/nordic/button/title/lime":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAHCAIAAABPxRC5AAAAAXNSR0IArs4c6QAAADJJREFUCJljlJOTZ0ACLAwMDOkPH0I4M+XlmSCsR8eh8lC+nCWS+tOzEPqZGFABI5r5AAKDByxtZmGqAAAAAElFTkSuQmCC","ui/nordic/common/border":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAYAAABWKLW/AAAAHklEQVQImU3JoQEAIAAEIc79d36LQSptm+dAFfTPBbwhCAFyaRw3AAAAAElFTkSuQmCC","ui/nordic/form/backgrounds/lime":"data:image/png;base64,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","ui/nordic/form/border":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAsCAYAAAAn4+taAAAAAXNSR0IArs4c6QAAAOBJREFUaIHt2TEOgkAUhOHBbCfY0uEpjBZyeiw0HkEwkRobwUZNtDBWLCQswg6b95UbivkToAAvipZvOEABwDaObe/oZZck35DH84WqvNneY8QPFgCAmeUdfyMhbCSEjYSwkRA2EsJGQthICBsJYSMhbCSEjYSwcSZE6Q7nfjD2jk7uVVk704YAwPGwH3SMqdV6oz1vDAGAPL94g6wx1PbB3ZlnRELYSAib1rfWlH7LNYY0va9ZaUPOWTr2jk7CMKydaUN0F7Jz72H//R2dKgUAWXqyvaM3t26ta1HY3tHbB2ZhH1oo31tJAAAAAElFTkSuQmCC"};

    const NORDIC_BUILTIN_JSON = {"ui/nordic/button/title/lime":{"base_size":[5,7],"nineslice_size":[2,2,2,4]},"ui/nordic/common/border":{"base_size":[3,3],"nineslice_size":[1,1,1,1]},"ui/nordic/form/border":{"nineslice_size":[25,29,25,9],"base_size":[50,44]}};

    function addBuiltinFilePath(
        fileSystem,
        path
    ) {
        const parts =
            String(path)
                .split("/")
                .filter(Boolean);

        let current =
            fileSystem;

        for (
            const part
            of parts
        ) {
            if (
                !current[part] ||
                typeof current[part] !==
                    "object"
            ) {
                current[part] = {};
            }

            current =
                current[part];
        }
    }

    async function builtinDataUrlToImageData(
        dataUrl,
        name
    ) {
        const response =
            await fetch(dataUrl);

        const blob =
            await response.blob();

        const file =
            new File(
                [blob],
                name,
                {
                    type:
                        blob.type ||
                        "image/png",
                }
            );

        return await fileImageData(
            file
        );
    }

    async function installNordicBuiltinAssets(
        mods
    ) {
        if (
            window.__RAG_NORDIC_BUILTINS_V26__
        ) {
            return;
        }

        window.__RAG_NORDIC_BUILTINS_V26__ =
            true;

        const fileSystem =
            mods.index.GLOBAL_FILE_SYSTEM;

        const tasks = [];

        for (
            const [path, dataUrl]
            of Object.entries(
                NORDIC_BUILTIN_PNG
            )
        ) {
            tasks.push(
                (async () => {
                    const existing =
                        mods.index.images.get(
                            path
                        );

                    // Replace only missing/fallback assets.
                    // A user-imported real asset always wins.
                    if (
                        !existing?.png ||
                        existing.__ragFallback
                    ) {
                        const png =
                            await builtinDataUrlToImageData(
                                dataUrl,
                                path
                                    .split("/")
                                    .pop() +
                                    ".png"
                            );

                        mods.index.images.set(
                            path,
                            {
                                png,
                                json:
                                    NORDIC_BUILTIN_JSON[
                                        path
                                    ],
                                __ragBuiltinNordic:
                                    true,
                                __ragBuiltinSource:
                                    "NORDIC_COSMETICS_RP_v4.9.14",
                            }
                        );
                    } else if (
                        NORDIC_BUILTIN_JSON[
                            path
                        ] &&
                        !existing.json
                    ) {
                        existing.json =
                            NORDIC_BUILTIN_JSON[
                                path
                            ];
                    }

                    addBuiltinFilePath(
                        fileSystem,
                        `${path}.png`
                    );

                    if (
                        NORDIC_BUILTIN_JSON[
                            path
                        ]
                    ) {
                        addBuiltinFilePath(
                            fileSystem,
                            `${path}.json`
                        );
                    }
                })()
            );
        }

        await Promise.all(
            tasks
        );

        console.log(
            "[RAG V26] Nordic built-in assets registrados:",
            Object.keys(
                NORDIC_BUILTIN_PNG
            )
        );
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

    function editorRoundTripMetadata(element, mods) {
        const instance = mods.index.GLOBAL_ELEMENT_MAP.get(
            element.dataset.id
        );

        const metadata = {
            version: 1,
            dataset: copyRagDataset(element),
            style: {
                left: element.style.left,
                top: element.style.top,
                width: element.style.width,
                height: element.style.height,
                zIndex: element.style.zIndex,
            },
            isEditable:
                typeof instance?.isEditable === "boolean"
                    ? instance.isEditable
                    : undefined,
        };

        if (instance instanceof mods.DraggableButton) {
            const label = instance.displayText?.label;
            const icon = instance.displayCanvas?.canvasHolder;

            metadata.button = {
                text: label?.value ?? element.dataset.displayText ?? "Label",
                labelStyle: label
                    ? {
                        left: label.style.left,
                        top: label.style.top,
                        fontSize: label.style.fontSize,
                        fontFamily: label.style.fontFamily,
                        textAlign: label.style.textAlign,
                    }
                    : null,
                displayTexture: element.dataset.displayImagePath || "",
                iconStyle: icon
                    ? {
                        left: icon.style.left,
                        top: icon.style.top,
                        width: icon.style.width,
                        height: icon.style.height,
                    }
                    : null,
            };
        }

        return metadata;
    }

    function applyRoundTripMetadata(instance, metadata) {
        if (typeof metadata === "string") {
            try {
                metadata = JSON.parse(metadata);
            } catch (_) {
                return;
            }
        }

        if (!instance || !metadata || typeof metadata !== "object") return;

        const element = instance.getMainHTMLElement?.();
        if (!(element instanceof HTMLElement)) return;

        restoreRagDataset(element, metadata.dataset);

        const style = metadata.style || {};
        for (const key of ["left", "top", "width", "height", "zIndex"]) {
            if (typeof style[key] === "string" && style[key]) {
                element.style[key] = style[key];
            }
        }

        if (typeof metadata.isEditable === "boolean") {
            if (typeof instance.setEditable === "function") {
                instance.setEditable(metadata.isEditable);
            } else {
                instance.isEditable = metadata.isEditable;
            }
        }

        const role = element.dataset.ragBorderSystemRole;

        if (role === "border" || element.dataset.ragFixedDecorative === "true") {
            element.style.pointerEvents = "none";
            instance.gridElement?.style.setProperty("pointer-events", "none");
            if (instance.resizeHandle) instance.resizeHandle.style.display = "none";
        } else if (role === "background") {
            element.style.pointerEvents = "auto";
            instance.gridElement?.style.setProperty("pointer-events", "auto");
            if (instance.resizeHandle) instance.resizeHandle.style.display = "block";
        }

        if (element.dataset.ragClipsChildren !== undefined) {
            element.style.overflow =
                element.dataset.ragClipsChildren === "true"
                    ? "hidden"
                    : "visible";
        }

        const ButtonClass = window.__RAG_LAST_MODS_V22__?.DraggableButton;

        if (ButtonClass && instance instanceof ButtonClass) {
            const button = metadata.button || {};
            const displayTexture =
                button.displayTexture ?? element.dataset.displayImagePath ?? "";

            if (displayTexture) {
                instance.setDisplayImage(displayTexture);
            } else if (instance.displayCanvas) {
                const child = instance.displayCanvas.getMainHTMLElement?.();
                const childId = child?.dataset?.id;
                child?.remove();
                instance.displayCanvas.outlineDiv?.remove();
                if (childId) {
                    window.__RAG_LAST_MODS_V22__.index.GLOBAL_ELEMENT_MAP.delete(childId);
                }
                instance.displayCanvas = undefined;
                element.dataset.displayImagePath = "";
            }

            if (instance.displayText) {
                const label = instance.displayText.label;
                label.value = button.text ?? element.dataset.displayText ?? label.value;
                element.dataset.displayText = label.value;
                instance.displayText.updateSize(false);

                for (const key of [
                    "left",
                    "top",
                    "fontSize",
                    "fontFamily",
                    "textAlign",
                ]) {
                    const value = button.labelStyle?.[key];
                    if (typeof value === "string" && value) {
                        label.style[key] = value;
                    }
                }

                if (button.labelStyle) {
                    element.dataset.ragAutoCenterLabel = "false";
                }

                instance.displayText.updateSize(false);
            }

            if (instance.displayCanvas && button.iconStyle) {
                const icon = instance.displayCanvas.canvasHolder;
                for (const key of ["left", "top"]) {
                    const value = button.iconStyle[key];
                    if (typeof value === "string" && value) icon.style[key] = value;
                }

                const width = parseFloat(button.iconStyle.width);
                const height = parseFloat(button.iconStyle.height);
                if (Number.isFinite(width) && Number.isFinite(height)) {
                    instance.displayCanvas.drawImage(width, height, false);
                }
            }
        }
    }

    function repairLegacyImportedLayers(mods) {
        for (const instance of mods.index.GLOBAL_ELEMENT_MAP.values()) {
            if (!(instance instanceof mods.DraggableCanvas)) continue;

            const element = instance.canvasHolder;
            const texture = String(element.dataset.imagePath || "").toLowerCase();
            const textureState = mods.index.images.get(
                normalizeTexture(texture)
            );

            decorateMissingTexture(instance, texture, textureState);

            const layer = Number(element.style.zIndex) || 0;
            const parentRect = element.parentElement?.getBoundingClientRect();
            const rect = element.getBoundingClientRect();
            const coversParent = Boolean(
                parentRect?.width &&
                parentRect?.height &&
                rect.width >= parentRect.width * 0.72 &&
                rect.height >= parentRect.height * 0.72
            );

            const looksLikeBorder =
                (
                    /(^|[\/_.-])(border|frame)([\/_.-]|$)/.test(texture) &&
                    (layer >= 40 || coversParent)
                ) ||
                (layer === 60 && coversParent);

            if (!looksLikeBorder) continue;

            element.dataset.ragBorderSystemRole = "border";
            element.dataset.ragFixedDecorative = "true";
            element.dataset.ragExplorerName = "BORDER";
            element.style.pointerEvents = "none";
            instance.gridElement?.style.setProperty("pointer-events", "none");
            instance.setEditable?.(false);
            if (instance.resizeHandle) instance.resizeHandle.style.display = "none";
        }
    }

    function patchNativeRoundTrip(mods) {
        if (mods.classToJsonUI.__ragRoundTripV31) return;
        mods.classToJsonUI.__ragRoundTripV31 = true;

        for (const className of [
            "draggable-panel",
            "draggable-collection_panel",
            "draggable-canvas",
            "draggable-button",
            "draggable-label",
            "draggable-scrolling_panel",
        ]) {
            const original = mods.classToJsonUI.get(className);
            if (!original) continue;

            mods.classToJsonUI.set(className, (element, namespace) => {
                const result = original(element, namespace);

                if (result?.element) {
                    // Panels in the upstream exporter use getBoundingClientRect,
                    // which can include viewport/browser scaling on mobile.
                    // Persist layout from CSS coordinates, matching the values
                    // used by dragging, resizing and the native importer.
                    if (
                        className === "draggable-panel" &&
                        Array.isArray(result.element.size)
                    ) {
                        const width = parseFloat(element.style.width);
                        const height = parseFloat(element.style.height);
                        const scalar = Number(mods.config.magicNumbers.UI_SCALAR) || 0.36;

                        if (Number.isFinite(width) && Number.isFinite(height)) {
                            result.element.size = [
                                width * scalar,
                                height * scalar,
                            ];

                            if (element.parentElement === mods.config.rootElement) {
                                result.element.offset = [
                                    parseFloat(element.style.left || "0") * scalar,
                                    parseFloat(element.style.top || "0") * scalar,
                                ];
                            }
                        }
                    }

                    // A string-valued JSON-UI variable remains harmless to the
                    // game while carrying editor-only state for a later import.
                    result.element.$rag_editor = JSON.stringify(
                        editorRoundTripMetadata(element, mods)
                    );
                }

                return result;
            });
        }

        const creators = mods.tagNameToCreateClassElementFunc;

        if (creators && !creators.__ragRoundTripV31) {
            creators.__ragRoundTripV31 = true;

            for (const [type, original] of [...creators.entries()]) {
                creators.set(type, (...args) => {
                    const result = original(...args);
                    applyRoundTripMetadata(result?.element, args[0]?.$rag_editor);
                    return result;
                });
            }
        }

        const originalUpload = mods.FormUploader.uploadForm;

        mods.FormUploader.uploadForm = function (...args) {
            window.__RAG_NATIVE_BUTTON_IMPORT__ = true;
            let result;

            try {
                result = originalUpload.apply(this, args);
            } finally {
                window.__RAG_NATIVE_BUTTON_IMPORT__ = false;
            }

            repairLegacyImportedLayers(mods);
            mods.index.Builder.updateExplorer();
            return result;
        };
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

    let ragCopyContext = {
        sourceId: null,
        parentId: null,
    };

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

        // If the original copied element is still selected,
        // paste into the exact same panel/slot remembered at COPY time.
        if (
            ragCopyContext.sourceId &&
            selectedId ===
                ragCopyContext.sourceId &&
            ragCopyContext.parentId
        ) {
            const parent =
                mods.index
                    .GLOBAL_ELEMENT_MAP
                    .get(
                        ragCopyContext.parentId
                    )
                    ?.getMainHTMLElement?.();

            if (parent) {
                return parent;
            }

            if (
                mods.config.rootElement
                    ?.dataset?.id ===
                ragCopyContext.parentId
            ) {
                return mods.config.rootElement;
            }
        }

        // Explicitly selected a panel/header/content slot:
        // paste into it.
        if (
            isContainer &&
            mods.index.Builder.isValidPath(
                selected
            )
        ) {
            return selected;
        }

        // Selected an image/label/button:
        // paste as its sibling in the nearest parent slot.
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

                ragCopyContext.sourceId =
                    selected.dataset.id;

                ragCopyContext.parentId =
                    selected.parentElement
                        ?.dataset?.id ||
                    mods.config.rootElement
                        ?.dataset?.id ||
                    null;

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
                        ? "Elemento colado no mesmo slot/painel."
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

    function realImageState(
        mods,
        path
    ) {
        const normalized =
            normalizeTexture(
                path
            );

        const state =
            migrateAutomaticNineSlice(
                normalized,
                mods.index.images.get(
                    normalized
                )
            );

        if (
            state?.png &&
            !state.__ragFallback
        ) {
            return {
                path:
                    normalized,
                state,
            };
        }

        return null;
    }

    function commonPrefixScore(
        a,
        b
    ) {
        const aa =
            normalizeTexture(a)
                .split("/");

        const bb =
            normalizeTexture(b)
                .split("/");

        let score =
            0;

        const max =
            Math.min(
                aa.length,
                bb.length
            );

        for (
            let i = 0;
            i < max;
            i++
        ) {
            if (
                aa[i] !== bb[i]
            ) {
                break;
            }

            score++;
        }

        return score;
    }

    function detectThemeName(
        headerPath
    ) {
        return pathBase(
            headerPath
        );
    }

    function detectFamilyRoot(
        headerPath
    ) {
        const path =
            normalizeTexture(
                headerPath
            );

        const marker =
            "/button/title/";

        const index =
            path.indexOf(
                marker
            );

        if (
            index !== -1
        ) {
            return path.slice(
                0,
                index
            );
        }

        const pieces =
            path.split("/");

        return pieces
            .slice(
                0,
                Math.max(
                    1,
                    pieces.length - 2
                )
            )
            .join("/");
    }

    function detectBorderTexture(
        headerPath,
        mods
    ) {
        const root =
            detectFamilyRoot(
                headerPath
            );

        const exactCandidates = [
            `${root}/form/border`,
            `${root}/common/border`,
        ];

        for (
            const candidate
            of exactCandidates
        ) {
            const result =
                realImageState(
                    mods,
                    candidate
                );

            if (
                result?.state?.json
            ) {
                return result;
            }
        }

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
                !state?.json ||
                state.__ragFallback
            ) {
                continue;
            }

            const base =
                pathBase(
                    path
                ).toLowerCase();

            if (
                base !== "border" &&
                !base.includes(
                    "border"
                )
            ) {
                continue;
            }

            let score =
                commonPrefixScore(
                    headerPath,
                    path
                ) * 20;

            if (
                normalizeTexture(
                    path
                ).includes(
                    "/form/"
                )
            ) {
                score += 80;
            }

            if (
                base === "border"
            ) {
                score += 50;
            }

            if (
                score >
                bestScore
            ) {
                bestScore =
                    score;

                best = {
                    path:
                        normalizeTexture(
                            path
                        ),
                    state,
                };
            }
        }

        return best;
    }

    function detectBackgroundTexture(
        headerPath,
        mods
    ) {
        const root =
            detectFamilyRoot(
                headerPath
            );

        const theme =
            detectThemeName(
                headerPath
            );

        const exactCandidates = [
            `${root}/form/backgrounds/${theme}`,
            `${root}/form/background/${theme}`,
            `${root}/backgrounds/${theme}`,
        ];

        for (
            const candidate
            of exactCandidates
        ) {
            const result =
                realImageState(
                    mods,
                    candidate
                );

            if (result) {
                return result;
            }
        }

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
                state.__ragFallback
            ) {
                continue;
            }

            const base =
                pathBase(
                    path
                ).toLowerCase();

            if (
                base !==
                theme.toLowerCase()
            ) {
                continue;
            }

            const normalized =
                normalizeTexture(
                    path
                );

            let score =
                commonPrefixScore(
                    headerPath,
                    path
                ) * 20;

            if (
                normalized.includes(
                    "/form/background"
                )
            ) {
                score += 120;
            }

            if (
                normalized.includes(
                    "/background"
                )
            ) {
                score += 60;
            }

            if (
                score >
                bestScore
            ) {
                bestScore =
                    score;

                best = {
                    path:
                        normalized,
                    state,
                };
            }
        }

        return best;
    }

    function largestInteriorTransparentRect(
        imageData
    ) {
        if (!imageData) {
            return null;
        }

        const width =
            imageData.width;

        const height =
            imageData.height;

        const data =
            imageData.data;

        const seen =
            new Uint8Array(
                width *
                height
            );

        const indexOf =
            (
                x,
                y
            ) =>
                y * width +
                x;

        let best =
            null;

        for (
            let y = 0;
            y < height;
            y++
        ) {
            for (
                let x = 0;
                x < width;
                x++
            ) {
                const index =
                    indexOf(
                        x,
                        y
                    );

                if (
                    seen[index]
                ) {
                    continue;
                }

                const alpha =
                    data[
                        index * 4 +
                        3
                    ];

                if (
                    alpha >
                    16
                ) {
                    seen[index] =
                        1;

                    continue;
                }

                const stack = [
                    [x, y],
                ];

                seen[index] =
                    1;

                let count =
                    0;

                let minX =
                    x;

                let maxX =
                    x;

                let minY =
                    y;

                let maxY =
                    y;

                let touchesEdge =
                    false;

                while (
                    stack.length
                ) {
                    const [
                        cx,
                        cy,
                    ] =
                        stack.pop();

                    count++;

                    minX =
                        Math.min(
                            minX,
                            cx
                        );

                    maxX =
                        Math.max(
                            maxX,
                            cx
                        );

                    minY =
                        Math.min(
                            minY,
                            cy
                        );

                    maxY =
                        Math.max(
                            maxY,
                            cy
                        );

                    if (
                        cx === 0 ||
                        cy === 0 ||
                        cx ===
                            width - 1 ||
                        cy ===
                            height - 1
                    ) {
                        touchesEdge =
                            true;
                    }

                    const neighbours = [
                        [
                            cx - 1,
                            cy,
                        ],
                        [
                            cx + 1,
                            cy,
                        ],
                        [
                            cx,
                            cy - 1,
                        ],
                        [
                            cx,
                            cy + 1,
                        ],
                    ];

                    for (
                        const [
                            nx,
                            ny,
                        ]
                        of neighbours
                    ) {
                        if (
                            nx < 0 ||
                            ny < 0 ||
                            nx >=
                                width ||
                            ny >=
                                height
                        ) {
                            continue;
                        }

                        const ni =
                            indexOf(
                                nx,
                                ny
                            );

                        if (
                            seen[ni]
                        ) {
                            continue;
                        }

                        const na =
                            data[
                                ni * 4 +
                                3
                            ];

                        if (
                            na >
                            16
                        ) {
                            continue;
                        }

                        seen[ni] =
                            1;

                        stack.push(
                            [
                                nx,
                                ny,
                            ]
                        );
                    }
                }

                if (
                    touchesEdge
                ) {
                    continue;
                }

                const rect = {
                    l:
                        minX,
                    t:
                        minY,
                    r:
                        maxX +
                        1,
                    b:
                        maxY +
                        1,
                    area:
                        count,
                };

                if (
                    !best ||
                    rect.area >
                        best.area
                ) {
                    best =
                        rect;
                }
            }
        }

        return best;
    }

    function normalizeNineData(
        json,
        imageData
    ) {
        if (
            !json ||
            !imageData
        ) {
            return null;
        }

        let slice =
            json.nineslice_size;

        let base =
            json.base_size;

        if (
            typeof slice ===
            "number"
        ) {
            slice = [
                slice,
                slice,
                slice,
                slice,
            ];
        }

        if (
            typeof base ===
            "number"
        ) {
            base = [
                base,
                base,
            ];
        }

        if (
            !Array.isArray(
                slice
            ) ||
            slice.length !==
                4
        ) {
            return null;
        }

        if (
            !Array.isArray(
                base
            ) ||
            base.length !==
                2
        ) {
            base = [
                imageData.width,
                imageData.height,
            ];
        }

        return {
            left:
                Number(
                    slice[0]
                ) || 0,
            top:
                Number(
                    slice[1]
                ) || 0,
            right:
                Number(
                    slice[2]
                ) || 0,
            bottom:
                Number(
                    slice[3]
                ) || 0,
            baseWidth:
                Number(
                    base[0]
                ) ||
                imageData.width,
            baseHeight:
                Number(
                    base[1]
                ) ||
                imageData.height,
        };
    }

    function mapNineCoordinate(
        coordinate,
        sourceTotal,
        startFixed,
        endFixed,
        destinationTotal,
        uiScale
    ) {
        const scale =
            Math.max(
                0.0001,
                Number(
                    uiScale
                ) || 1
            );

        const destStart =
            Math.round(
                startFixed /
                scale
            );

        const destEnd =
            Math.round(
                endFixed /
                scale
            );

        const sourceMiddle =
            sourceTotal -
            startFixed -
            endFixed;

        const destMiddle =
            destinationTotal -
            destStart -
            destEnd;

        const sourceEndStart =
            sourceTotal -
            endFixed;

        if (
            coordinate <=
            startFixed
        ) {
            if (
                startFixed <=
                0
            ) {
                return 0;
            }

            return (
                coordinate /
                startFixed
            ) * destStart;
        }

        if (
            coordinate >=
            sourceEndStart
        ) {
            if (
                endFixed <=
                0
            ) {
                return destinationTotal;
            }

            return (
                destStart +
                destMiddle +
                (
                    (
                        coordinate -
                        sourceEndStart
                    ) /
                    endFixed
                ) *
                destEnd
            );
        }

        if (
            sourceMiddle <=
            0
        ) {
            return (
                destStart +
                destMiddle /
                2
            );
        }

        return (
            destStart +
            (
                (
                    coordinate -
                    startFixed
                ) /
                sourceMiddle
            ) *
            destMiddle
        );
    }

    function mapTransparentWindow(
        borderState,
        destinationWidth,
        destinationHeight,
        mods
    ) {
        const sourceRect =
            largestInteriorTransparentRect(
                borderState?.png
            );

        if (
            !sourceRect
        ) {
            return null;
        }

        const nine =
            normalizeNineData(
                borderState.json,
                borderState.png
            );

        if (
            !nine
        ) {
            const sx =
                destinationWidth /
                borderState.png
                    .width;

            const sy =
                destinationHeight /
                borderState.png
                    .height;

            return {
                left:
                    sourceRect.l *
                    sx,
                top:
                    sourceRect.t *
                    sy,
                right:
                    sourceRect.r *
                    sx,
                bottom:
                    sourceRect.b *
                    sy,
            };
        }

        const uiScale =
            mods.config
                .magicNumbers
                .UI_SCALAR;

        return {
            left:
                mapNineCoordinate(
                    sourceRect.l,
                    nine.baseWidth,
                    nine.left,
                    nine.right,
                    destinationWidth,
                    uiScale
                ),
            top:
                mapNineCoordinate(
                    sourceRect.t,
                    nine.baseHeight,
                    nine.top,
                    nine.bottom,
                    destinationHeight,
                    uiScale
                ),
            right:
                mapNineCoordinate(
                    sourceRect.r,
                    nine.baseWidth,
                    nine.left,
                    nine.right,
                    destinationWidth,
                    uiScale
                ),
            bottom:
                mapNineCoordinate(
                    sourceRect.b,
                    nine.baseHeight,
                    nine.top,
                    nine.bottom,
                    destinationHeight,
                    uiScale
                ),
        };
    }

    function borderRoleElement(
        host,
        role
    ) {
        return [
            ...host.children,
        ].find(
            (
                child
            ) =>
                child instanceof
                    HTMLElement &&
                child.dataset
                    ?.ragBorderSystemRole ===
                    role
        ) || null;
    }

    function borderRoleInstance(
        host,
        role,
        mods
    ) {
        const element =
            borderRoleElement(
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

    async function createBorderSystemCanvas(
        parent,
        texturePath,
        role,
        mods,
        layer
    ) {
        const existing =
            borderRoleElement(
                parent,
                role
            );

        if (
            existing
        ) {
            return mods.index
                .GLOBAL_ELEMENT_MAP
                .get(
                    existing.dataset.id
                ) || null;
        }

        const state =
            realImageState(
                mods,
                texturePath
            )?.state;

        if (
            !state?.png
        ) {
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
                normalizeTexture(
                    texturePath
                ),
                state.json
            );

        mods.index
            .GLOBAL_ELEMENT_MAP
            .set(
                id,
                canvas
            );

        canvas.canvasHolder
            .dataset
            .ragBorderSystemRole =
            role;

        if (role === "border") {
            canvas.canvasHolder
                .dataset
                .ragExplorerName =
                "BORDER";
        }

        canvas.canvasHolder
            .dataset
            .ragFixedDecorative =
            "true";

        canvas.canvasHolder
            .dataset
            .ragKeepAspect =
            "false";

        canvas.canvasHolder
            .style.pointerEvents =
            "none";

        canvas.canvasHolder
            .style.zIndex =
            String(layer);

        canvas.gridElement
            .style.pointerEvents =
            "none";

        canvas.resizeHandle
            .style.display =
            "none";

        return canvas;
    }

    function sizeBorderCanvas(
        canvas,
        left,
        top,
        width,
        height
    ) {
        if (!canvas) {
            return;
        }

        const element =
            canvas.canvasHolder;

        element.style.left =
            `${left}px`;

        element.style.top =
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

    function findBorderContentSlot(
        panel,
        mods
    ) {
        const host =
            panelMainElement(
                panel
            );

        if (!host) {
            return null;
        }

        for (
            const child
            of host.children
        ) {
            if (
                !(child instanceof
                    HTMLElement) ||
                child.dataset
                    ?.ragBorderContentSlot !==
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

    async function ensureBorderContentSlot(
        panel,
        backgroundPath,
        mods
    ) {
        let slot =
            findBorderContentSlot(
                panel,
                mods
            );

        if (
            !slot
        ) {
            const parent =
                panelMainElement(
                    panel
                );

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

            slot.panel.dataset
                .ragBorderContentSlot =
                "true";

            slot.panel.dataset
                .ragExplorerName =
                "CONTENT SLOT";

            slot.panel.dataset
                .ragClipsChildren =
                "true";

            slot.panel.style.overflow =
                "hidden";

            slot.panel.style.backgroundColor =
                "rgba(0,0,0,0)";

            slot.panel.style.zIndex =
                "20";
        }

        const slotHost =
            panelMainElement(
                slot
            );

        if (
            backgroundPath &&
            !borderRoleElement(
                slotHost,
                "background"
            )
        ) {
            const state =
                realImageState(
                    mods,
                    backgroundPath
                )?.state;

            if (state?.png) {
                const bgId =
                    crypto.randomUUID?.()
                        ?.replace(/-/g, "")
                        .slice(0, 15) ||
                    Math.random()
                        .toString(36)
                        .slice(2, 17);

                const bg =
                    new mods.DraggableCanvas(
                        bgId,
                        slotHost,
                        state.png,
                        normalizeTexture(
                            backgroundPath
                        ),
                        state.json
                    );

                mods.index
                    .GLOBAL_ELEMENT_MAP
                    .set(
                        bgId,
                        bg
                    );

                // IMPORTANT V27:
                // Background is a NORMAL editable image.
                // Do NOT mark it ragFixedDecorative.
                bg.canvasHolder
                    .dataset
                    .ragBorderSystemRole =
                    "background";

                bg.canvasHolder
                    .dataset
                    .ragBorderBackground =
                    "true";

                bg.canvasHolder
                    .dataset
                    .ragExplorerName =
                    "BACKGROUND";

                bg.canvasHolder
                    .dataset
                    .ragKeepAspect =
                    "false";

                bg.canvasHolder
                    .style.pointerEvents =
                    "auto";

                bg.canvasHolder
                    .style.zIndex =
                    "10";

                bg.gridElement
                    .style.pointerEvents =
                    "auto";

                bg.resizeHandle
                    .style.display =
                    "block";

                // It will be fitted once after the content slot gets
                // its final size. After that the user owns position/size.
                bg.canvasHolder
                    .dataset
                    .ragBackgroundInitialized =
                    "false";
            }
        }

        return slot;
    }

    function syncBorderSystem(
        panel,
        mods
    ) {
        const host =
            panelMainElement(
                panel
            );

        if (
            !host ||
            host.dataset
                .ragBorderSystem !==
                "true"
        ) {
            return;
        }

        const border =
            borderRoleInstance(
                host,
                "border",
                mods
            );

        if (!border) {
            return;
        }

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

        border.canvasHolder
            .style.zIndex =
            "60";

        sizeBorderCanvas(
            border,
            0,
            0,
            width,
            height
        );

        const borderPath =
            border.canvasHolder
                .dataset
                .imagePath;

        const borderState =
            mods.index.images.get(
                borderPath
            );

        let windowRect =
            mapTransparentWindow(
                borderState,
                width,
                height,
                mods
            );

        if (
            !windowRect
        ) {
            windowRect = {
                left:
                    Math.max(
                        12,
                        width *
                        0.06
                    ),
                top:
                    Math.max(
                        60,
                        height *
                        0.22
                    ),
                right:
                    width -
                    Math.max(
                        12,
                        width *
                        0.06
                    ),
                bottom:
                    height -
                    Math.max(
                        12,
                        height *
                        0.06
                    ),
            };
        }

        const slot =
            findBorderContentSlot(
                panel,
                mods
            );

        if (
            slot
        ) {
            const slotHost =
                panelMainElement(
                    slot
                );

            slotHost.style.left =
                `${Math.max(
                    0,
                    windowRect.left
                )}px`;

            slotHost.style.top =
                `${Math.max(
                    0,
                    windowRect.top
                )}px`;

            slotHost.style.width =
                `${Math.max(
                    1,
                    windowRect.right -
                    windowRect.left
                )}px`;

            slotHost.style.height =
                `${Math.max(
                    1,
                    windowRect.bottom -
                    windowRect.top
                )}px`;

            const background =
                borderRoleInstance(
                    slotHost,
                    "background",
                    mods
                );

            if (
                background &&
                background.canvasHolder
                    .dataset
                    .ragBackgroundInitialized !==
                    "true"
            ) {
                // Initial fit only.
                // After this the user is free to move/resize it.
                sizeBorderCanvas(
                    background,
                    0,
                    0,
                    parseFloat(
                        slotHost
                            .style.width
                    ) || 1,
                    parseFloat(
                        slotHost
                            .style.height
                    ) || 1
                );

                background.canvasHolder
                    .dataset
                    .ragBackgroundInitialized =
                    "true";
            }
        }

        // Header is created once and remains editable.
        // We only auto-place it until the user moves it.
        const headerId =
            host.dataset
                .ragBorderHeaderId;

        if (
            headerId
        ) {
            const header =
                mods.index
                    .GLOBAL_ELEMENT_MAP
                    .get(
                        headerId
                    );

            const headerHost =
                headerMainElement(
                    header
                );

            if (headerHost) {
                headerHost.style.zIndex =
                    "120";
            }

            if (
                headerHost &&
                headerHost.dataset
                    .ragHeaderUserMoved !==
                    "true"
            ) {
                const topArea =
                    Math.max(
                        30,
                        windowRect.top
                    );

                const headerHeight =
                    Math.max(
                        34,
                        Math.min(
                            70,
                            topArea *
                            0.58
                        )
                    );

                const headerTop =
                    Math.max(
                        6,
                        (
                            topArea -
                            headerHeight
                        ) /
                        2
                    );

                headerHost.style.left =
                    `${Math.max(
                        0,
                        windowRect.left
                    )}px`;

                headerHost.style.top =
                    `${headerTop}px`;

                headerHost.style.width =
                    `${Math.max(
                        40,
                        windowRect.right -
                        windowRect.left
                    )}px`;

                headerHost.style.height =
                    `${headerHeight}px`;

                syncHeaderBackground(
                    header,
                    mods
                );
            }
        }
    }

    function ensureBorderSystemObserver(
        mods
    ) {
        if (
            chromeResizeObserver ||
            !window.ResizeObserver
        ) {
            return;
        }

        const pending =
            new Map();

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

                        const panel =
                            mods.index
                                .GLOBAL_ELEMENT_MAP
                                .get(
                                    id
                                );

                        if (
                            !panel
                        ) {
                            continue;
                        }

                        clearTimeout(
                            pending.get(
                                id
                            )
                        );

                        pending.set(
                            id,
                            setTimeout(
                                () => {
                                    syncBorderSystem(
                                        panel,
                                        mods
                                    );

                                    pending.delete(
                                        id
                                    );
                                },
                                60
                            )
                        );
                    }
                }
            );
    }

    async function createAutoHeaderAndBorder(
        panel,
        mods
    ) {
        await installNordicBuiltinAssets(
            mods
        );

        let headerPath;

        try {
            headerPath =
                await mods
                    .chooseImageModal();
        } catch (_) {
            return;
        }

        if (
            !headerPath
        ) {
            return;
        }

        const headerState =
            realImageState(
                mods,
                headerPath
            );

        if (
            !headerState
        ) {
            showBanner(
                "Textura do header nao encontrada.",
                "error"
            );

            return;
        }

        const border =
            detectBorderTexture(
                headerPath,
                mods
            );

        if (
            !border
        ) {
            showBanner(
                "Nao achei um border compatível nos assets internos/importados.",
                "error"
            );

            return;
        }

        const background =
            detectBackgroundTexture(
                headerPath,
                mods
            );

        const host =
            panelMainElement(
                panel
            );

        host.dataset.ragBorderSystem =
            "true";

        host.dataset.ragBorderTexture =
            border.path;

        host.dataset.ragBorderHeaderTexture =
            normalizeTexture(
                headerPath
            );

        if (
            background
        ) {
            host.dataset.ragBorderBackgroundTexture =
                background.path;
        }

        let borderCanvas =
            borderRoleInstance(
                host,
                "border",
                mods
            );

        if (
            !borderCanvas
        ) {
            borderCanvas =
                await createBorderSystemCanvas(
                    host,
                    border.path,
                    "border",
                    mods,
                    60
                );
        }

        const slot =
            await ensureBorderContentSlot(
                panel,
                background?.path ||
                    null,
                mods
            );

        let header =
            null;

        const oldHeaderId =
            host.dataset
                .ragBorderHeaderId;

        if (
            oldHeaderId
        ) {
            header =
                mods.index
                    .GLOBAL_ELEMENT_MAP
                    .get(
                        oldHeaderId
                    ) || null;
        }

        if (
            !header
        ) {
            header =
                await createEditableHeader(
                    panel,
                    mods,
                    headerPath
                );

            if (
                header
            ) {
                host.dataset.ragBorderHeaderId =
                    header
                        .getMainHTMLElement()
                        .dataset.id;

                header
                    .getMainHTMLElement()
                    .dataset.ragBorderHeader =
                    "true";

                header
                    .getMainHTMLElement()
                    .dataset.ragExplorerName =
                    "HEADER";

                header
                    .getMainHTMLElement()
                    .style.zIndex =
                    "120";

                const originalStartDrag =
                    header.startDrag
                        .bind(
                            header
                        );

                header.startDrag =
                    function (
                        event
                    ) {
                        this.getMainHTMLElement()
                            .dataset
                            .ragHeaderUserMoved =
                            "true";

                        return originalStartDrag(
                            event
                        );
                    };
            }
        }

        setPanelClipping(
            panel,
            true
        );

        ensureBorderSystemObserver(
            mods
        );

        chromeResizeObserver
            ?.observe(
                host
            );

        syncBorderSystem(
            panel,
            mods
        );

        mods.index.Builder
            .updateExplorer();

        if (
            slot
        ) {
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

        const backgroundText =
            background
                ? ` | background: ${background.path}`
                : " | background nao detectado";

        showBanner(
            `Border system: ${border.path} | header: ${normalizeTexture(headerPath)}${backgroundText}`,
            "success"
        );
    }

    function patchCopyPasteAutoChrome(
        mods
    ) {
        ensureBorderSystemObserver(
            mods
        );
    }

    function patchExplorerNames(
        mods
    ) {
        const Explorer =
            mods.ExplorerController;

        if (
            !Explorer ||
            Explorer.__ragNamesV27
        ) {
            return;
        }

        Explorer.__ragNamesV27 =
            true;

        const originalUpdate =
            Explorer.updateExplorer
                .bind(
                    Explorer
                );

        function elementLabel(
            element
        ) {
            if (
                element?.dataset
                    ?.ragExplorerName
            ) {
                return element.dataset
                    .ragExplorerName;
            }

            if (
                element?.dataset
                    ?.ragBorderBackground ===
                "true"
            ) {
                return "BACKGROUND";
            }

            if (
                element?.dataset
                    ?.ragBorderSystemRole ===
                "border"
            ) {
                return "BORDER";
            }

            if (
                element?.dataset
                    ?.ragHeader ===
                "true"
            ) {
                return "HEADER";
            }

            if (
                element?.dataset
                    ?.ragBorderContentSlot ===
                "true"
            ) {
                return "CONTENT SLOT";
            }

            return null;
        }

        function sourceChildren(
            source
        ) {
            const result = [];

            for (
                const child
                of source.children
            ) {
                const target =
                    child.dataset
                        ?.skip ===
                        "true"
                        ? child.firstChild
                        : child;

                if (
                    target instanceof
                        HTMLElement &&
                    target.dataset?.id
                ) {
                    result.push(
                        target
                    );
                }
            }

            return result;
        }

        function explorerChildren(
            node
        ) {
            return [
                ...node.children,
            ].filter(
                (child) =>
                    child instanceof
                        HTMLElement &&
                    child.classList
                        .contains(
                            "explorerDiv"
                        )
            );
        }

        function decorate(
            source,
            explorerNode
        ) {
            const label =
                elementLabel(
                    source
                );

            if (label) {
                const text =
                    [
                        ...explorerNode
                            .children,
                    ].find(
                        (child) =>
                            child.classList
                                ?.contains(
                                    "explorerText"
                                )
                    );

                if (text) {
                    text.textContent =
                        label;
                }
            }

            const sChildren =
                sourceChildren(
                    source
                );

            const eChildren =
                explorerChildren(
                    explorerNode
                );

            const count =
                Math.min(
                    sChildren.length,
                    eChildren.length
                );

            for (
                let i = 0;
                i < count;
                i++
            ) {
                decorate(
                    sChildren[i],
                    eChildren[i]
                );
            }
        }

        Explorer.updateExplorer =
            function (...args) {
                const result =
                    originalUpdate(
                        ...args
                    );

                const root =
                    mods.config
                        .rootElement;

                const explorer =
                    document.getElementById(
                        "explorer"
                    );

                const rootNode =
                    explorer
                        ? [
                            ...explorer
                                .children,
                        ].find(
                            (child) =>
                                child instanceof
                                    HTMLElement &&
                                child.classList
                                    .contains(
                                        "explorerDiv"
                                    )
                        )
                        : null;

                if (
                    root &&
                    rootNode
                ) {
                    decorate(
                        root,
                        rootNode
                    );
                }

                return result;
            };

        // Rebuild once so existing auto-system objects get names immediately.
        Explorer.updateExplorer();
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
            "Add Border System Auto";

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

    function installExplorerDock() {
        const explorer = document.getElementById("explorer");

        if (!explorer || document.querySelector(".rag-explorer-dock")) return;

        const dock = document.createElement("aside");
        dock.className = "rag-explorer-dock";

        const header = document.createElement("div");
        header.className = "rag-explorer-dock-header";

        const title = document.createElement("strong");
        title.textContent = "ITENS / CAMADAS";

        const count = document.createElement("span");
        count.className = "rag-explorer-count";

        const close = document.createElement("button");
        close.type = "button";
        close.className = "rag-explorer-close";
        close.textContent = "RECOLHER";

        const reopen = document.createElement("button");
        reopen.type = "button";
        reopen.className = "rag-explorer-reopen";
        reopen.textContent = "ITENS";

        const updateCount = () => {
            count.textContent = `${explorer.querySelectorAll(".explorerDiv").length} itens`;
        };

        const setOpen = (open) => {
            dock.classList.toggle("is-collapsed", !open);
            reopen.classList.toggle("is-visible", !open);
        };

        close.addEventListener("click", () => setOpen(false));
        reopen.addEventListener("click", () => setOpen(true));

        header.append(title, count, close);
        dock.append(header, explorer);
        document.body.append(dock, reopen);

        new MutationObserver(updateCount).observe(explorer, {
            childList: true,
            subtree: true,
        });

        updateCount();
        setOpen(true);
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
        updateMissingTexturePanel();
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
                    ?.ragBorderSystem ===
                "true"
            ) {
                ensureBorderSystemObserver(
                    mods
                );

                chromeResizeObserver
                    ?.observe(
                        panelMainElement(
                            panelInstance
                        )
                    );

                syncBorderSystem(
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
                        : (
                            panelElement?.dataset
                                ?.ragContentSlot ===
                                "true" ||
                            panelElement?.dataset
                                ?.ragBorderContentSlot ===
                                "true"
                        )
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
                        "BORDER + HEADER + FUNDO AUTO";

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

        const roleEditor = document.createElement("label");
        roleEditor.className = "rag-image-property-role";

        const roleEditorTitle = document.createElement("span");
        roleEditorTitle.textContent = "FUNCAO DA IMAGEM";

        const roleEditorSelect = document.createElement("select");

        for (const [value, label] of [
            ["image", "Imagem normal / icone"],
            ["background", "Background do painel"],
            ["border", "Borda / frame do painel"],
            ["header", "Transformar em header"],
        ]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            roleEditorSelect.appendChild(option);
        }

        const currentRole =
            instance.canvasHolder.dataset.ragBorderSystemRole;

        roleEditorSelect.value =
            currentRole === "background" || currentRole === "border"
                ? currentRole
                : "image";

        roleEditorSelect.addEventListener("change", async () => {
            const role = roleEditorSelect.value;
            roleEditorSelect.disabled = true;

            try {
                if (role === "header") {
                    const header = await createImportedHeader(
                        instance.canvasHolder.dataset.imagePath,
                        mods
                    );

                    if (header) {
                        mods.index.Builder.delete(id);
                    } else {
                        roleEditorSelect.value = "image";
                    }
                } else {
                    applyImportedImageRole(instance, role, mods);
                    showBanner(
                        role === "background"
                            ? "Imagem convertida em BACKGROUND."
                            : role === "border"
                            ? "Imagem convertida em BORDA fixa."
                            : "Imagem convertida em item normal.",
                        "success"
                    );
                }
            } catch (error) {
                console.error(error);
                roleEditorSelect.value = "image";
                showBanner(
                    `Falha ao mudar funcao: ${error?.message || error}`,
                    "error"
                );
            } finally {
                roleEditorSelect.disabled = false;
            }
        });

        roleEditor.append(roleEditorTitle, roleEditorSelect);

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
            roleEditor,
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

        if (
            instance.canvasHolder
                .dataset
                .ragBorderBackground ===
            "true"
        ) {
            const backgroundTitle =
                document.createElement(
                    "div"
                );

            backgroundTitle.className =
                "rag-control-tools-title";

            backgroundTitle.textContent =
                "BACKGROUND EDITAVEL";

            const fitSlot =
                document.createElement(
                    "button"
                );

            fitSlot.type =
                "button";

            fitSlot.className =
                "propertyInputButton";

            fitSlot.textContent =
                "AJUSTAR AO CONTENT SLOT";

            fitSlot.addEventListener(
                "click",
                () => {
                    const rect =
                        instance.container
                            .getBoundingClientRect();

                    instance.canvasHolder
                        .style.left =
                        "0px";

                    instance.canvasHolder
                        .style.top =
                        "0px";

                    instance.drawImage(
                        rect.width,
                        rect.height,
                        false
                    );

                    instance.canvasHolder
                        .dataset
                        .ragBackgroundInitialized =
                        "true";

                    mods.updatePropertiesArea();
                }
            );

            const info =
                document.createElement(
                    "div"
                );

            info.className =
                "rag-panel-tools-hint";

            info.textContent =
                "BACKGROUND = camada 10. Pode mover e redimensionar livremente dentro do Content Slot.";

            box.append(
                backgroundTitle,
                fitSlot,
                info
            );
        }

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


.rag-builtin-assets-note {
    margin: 6px 0 8px;
    padding: 6px 8px;
    border: 1px solid rgba(129,210,145,.45);
    border-radius: 6px;
    background: rgba(45,100,57,.16);
    color: #9de5ad;
    text-align: center;
    font-size: 9px;
    font-weight: 800;
}

.rag-file-picker {
    margin: 10px 0 12px;
    padding: 10px;
    border: 1px solid rgba(159,54,220,.48);
    border-radius: 9px;
    background: rgba(20,20,23,.76);
}

.rag-image-role-box,
.rag-image-property-role {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin: 0 0 10px;
    color: #e7c5ff;
    font: 900 10px/1.2 sans-serif;
}

.rag-image-role-box select,
.rag-image-property-role select {
    width: 100%;
    min-height: 42px;
    padding: 6px 8px;
    border: 1px solid #a542de;
    border-radius: 6px;
    background: #252329;
    color: white;
    font-weight: 800;
}

.rag-image-role-box small {
    color: #aaa;
    font-size: 9px;
    font-weight: 500;
}

.rag-image-property-role {
    margin-top: 8px;
    padding: 8px;
    border: 1px solid rgba(165,66,222,.45);
    border-radius: 6px;
    background: rgba(42,28,49,.65);
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
        rgba(55, 55, 55, 1);

    background-image:
        linear-gradient(
            to right,
            var(--rag-grid-line) 2px,
            transparent 2px
        ),
        linear-gradient(
            to bottom,
            var(--rag-grid-line) 2px,
            transparent 2px
        ) !important;

    background-size:
        calc(100% / var(--grid-cols))
        calc(100% / var(--grid-rows))
        !important;

    background-position:
        -1px -1px !important;

    opacity:
        1;
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





[data-rag-border-background="true"] {
    pointer-events: auto !important;
}

[data-rag-border-background="true"] > .resize-handle {
    display: block !important;
}

[data-rag-border-system-role="border"] {
    pointer-events: none !important;
}

[data-rag-header="true"] {
    z-index: 120 !important;
}

[data-rag-border-content-slot="true"] {
    background: rgba(0,0,0,.03);
    outline-style: dashed !important;
}

[data-rag-border-system-role="border"] {
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
    outline: 3px dashed #ffbd3d !important;
}

.rag-missing-texture-label {
    position: absolute;
    top: 5px;
    left: 5px;
    z-index: 2147480900;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    max-width: calc(100% - 10px);
    max-height: calc(100% - 10px);
    padding: 4px 7px;
    overflow: hidden;
    border: 1px solid #ffbd3d;
    border-radius: 4px;
    background: rgba(18, 18, 21, .9);
    color: white;
    font: 800 9px/1.25 monospace;
    pointer-events: none;
}

.rag-missing-texture-label b {
    color: #ffcf66;
    white-space: nowrap;
}

.rag-missing-texture-label span {
    overflow: hidden;
    color: #fff;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.rag-missing-textures-panel {
    position: fixed;
    left: 12px;
    bottom: 12px;
    z-index: 2147482100;
    width: min(430px, calc(100vw - 24px));
    max-height: min(62vh, 520px);
    overflow: hidden;
    border: 2px solid #d58b19;
    border-radius: 9px;
    background: rgba(25, 25, 29, .97);
    color: white;
    box-shadow: 0 10px 30px rgba(0, 0, 0, .5);
}

.rag-missing-textures-panel summary {
    padding: 12px 14px;
    background: #65420d;
    color: #ffd98c;
    font: 900 12px/1.2 sans-serif;
    cursor: pointer;
    touch-action: manipulation;
}

.rag-missing-textures-intro {
    padding: 10px 12px 5px;
    color: #ddd;
    font-size: 11px;
}

.rag-missing-textures-list {
    max-height: min(48vh, 390px);
    padding: 6px 10px 12px;
    overflow: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
}

.rag-missing-textures-list code {
    display: block;
    margin: 4px 0;
    padding: 6px 8px;
    overflow-wrap: anywhere;
    border-radius: 4px;
    background: #353238;
    color: #ffe0a3;
    font-size: 10px;
}

.rag-explorer-dock {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 2147482000;
    display: flex;
    flex-direction: column;
    width: clamp(300px, 34vw, 440px);
    height: calc(100vh - 24px);
    height: calc(100dvh - 24px);
    min-height: 320px;
    overflow: hidden;
    border: 2px solid rgba(166, 66, 222, .85);
    border-radius: 12px;
    background: rgba(28, 28, 32, .97);
    box-shadow: 0 12px 38px rgba(0, 0, 0, .55);
}

.rag-explorer-dock.is-collapsed {
    display: none;
}

.rag-explorer-dock-header {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 8px 10px;
    color: white;
    background: linear-gradient(135deg, #4a1666, #7a1e91);
}

.rag-explorer-count {
    color: #d9b4ec;
    font-size: 11px;
    white-space: nowrap;
}

.rag-explorer-close,
.rag-explorer-reopen {
    min-height: 34px;
    padding: 7px 10px;
    border: 1px solid rgba(255, 255, 255, .35);
    border-radius: 7px;
    background: #29292e;
    color: white;
    font-weight: 900;
    touch-action: manipulation;
}

.rag-explorer-reopen {
    position: fixed;
    top: 70px;
    right: 12px;
    z-index: 2147482000;
    display: none;
    min-width: 76px;
    min-height: 46px;
    border-color: #a542de;
    background: rgba(35, 25, 42, .97);
}

.rag-explorer-reopen.is-visible {
    display: block;
}

.rag-explorer-dock > .explorer {
    flex: 1 1 auto;
    width: auto !important;
    height: auto !important;
    max-width: none !important;
    max-height: none !important;
    min-height: 0;
    margin: 8px !important;
    overflow-x: auto !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
    touch-action: pan-x pan-y;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
    scrollbar-color: #a542de #27272b;
}

.rag-explorer-dock .explorerDiv {
    min-height: 28px;
}

.rag-explorer-dock .explorerText {
    display: inline-block;
    min-height: 28px;
    line-height: 28px;
    white-space: nowrap;
}

.rag-panel-lock-guide {
    position: absolute;
    z-index: 2147481500;
    pointer-events: none;
    background: #00d9ff;
    box-shadow: 0 0 5px rgba(0, 217, 255, .9);
}

.rag-panel-lock-x {
    top: 0;
    bottom: 0;
    width: 2px;
    transform: translateX(-1px);
}

.rag-panel-lock-y {
    left: 0;
    right: 0;
    height: 2px;
    transform: translateY(-1px);
}

@media (pointer: coarse) {
    .rag-explorer-dock {
        width: min(92vw, 440px);
    }

    .rag-explorer-dock-header {
        min-height: 56px;
    }

    .rag-explorer-close,
    .rag-explorer-reopen {
        min-height: 46px;
    }

    .rag-explorer-dock .explorerDiv,
    .rag-explorer-dock .explorerText {
        min-height: 42px;
        line-height: 42px;
    }

    .rag-explorer-dock .explorerArrow,
    .rag-explorer-dock .explorerVisibilityToggle {
        min-width: 28px;
        min-height: 28px;
    }
}

/* Match the original editor's blue center marker while keeping it above
   the custom background/border/header layers. Display remains controlled by
   the native startDrag/stopDrag methods. */
#main_window .center-point {
    width: 10px !important;
    height: 10px !important;
    border-radius: 50% !important;
    background-color: blue !important;
    opacity: 1 !important;
    pointer-events: none !important;
    z-index: 2147481000 !important;
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
                    "pointerdown",
                    explorerPointerDown,
                    { passive: true }
                );

            document
                .getElementById("explorer")
                ?.addEventListener(
                    "pointerup",
                    explorerPointerUp,
                    { passive: true }
                );

            document
                .getElementById("explorer")
                ?.addEventListener(
                    "pointercancel",
                    explorerPointerCancel,
                    { passive: true }
                );

            installTouchModeButton();
        }

        const mods = await loadModules();

        window.__RAG_LAST_MODS_V22__ =
            mods;

        patchCompoundButtons(mods);
        installOriginalPreviewGrid(mods);

        await installNordicBuiltinAssets(
            mods
        );

        patchClipsChildrenExport(mods);
        patchAdvancedControlExport(mods);
        patchNativeRoundTrip(mods);
        patchSelectedItemDragLock(mods);
        patchNestedPanelDrag(mods);
        patchPanelLock(mods);
        patchCopyPasteMetadata(mods);
        patchCopyPasteAutoChrome(mods);
        patchExplorerNames(mods);

        installCopyPasteButtons(mods);
        installExpandedSidebar(mods);
        installExplorerDock();

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
