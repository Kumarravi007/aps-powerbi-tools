'use strict';

import powerbi from 'powerbi-visuals-api';
import { FormattingSettingsService } from 'powerbi-visuals-utils-formattingmodel';
import '../style/visual.less';

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from './settings';
import { initializeViewerRuntime, loadModel, getVisibleNodes, getExternalIdMap, getExternalIds } from './viewer.utils';

/**
 * Custom visual wrapper for the Autodesk Platform Services Viewer.
 */
export class Visual implements IVisual {
    private host: IVisualHost;
    private container: HTMLElement;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private currentDataView: DataView = null;
    private accessTokenEndpoint: string = null;
    private selectionManager: ISelectionManager = null;
    private urn: string = '';
    private guid: string = '';
    private viewer: Autodesk.Viewing.GuiViewer3D = null;
    private model: Autodesk.Viewing.Model = null;
    private externalIdsMap: { [externalId: string]: number } = null;

    /**
     * Initializes the viewer visual.
     * @param options Additional visual initialization options.
     */
    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();
        this.container = options.element;
        this.getAccessToken = this.getAccessToken.bind(this);
    }

    /**
     * Notifies the viewer visual of an update (data, viewmode, size change).
     * @param options Additional visual update options.
     */
    public async update(options: VisualUpdateOptions) {
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews);

        const { accessTokenEndpoint } = this.formattingSettings.card;
        if (accessTokenEndpoint.value !== this.accessTokenEndpoint) {
            this.accessTokenEndpoint = accessTokenEndpoint.value;
            this.initializeViewer();
        }

        const { urn, guid } = this.formattingSettings.card;
        if (urn.value !== this.urn || guid.value !== this.guid) {
            this.urn = urn.value;
            this.guid = guid.value;
            this.updateModel();
        }

        if (options.dataViews.length > 0) {
            this.currentDataView = options.dataViews[0];
        }

        if (this.viewer && this.externalIdsMap && this.currentDataView) {
            const externalIds = this.currentDataView.table?.rows;
            if (externalIds?.length > 0) {
                //@ts-ignore
                const dbids = externalIds.map(e => this.externalIdsMap[e[0]]);
                this.viewer.select(dbids);
                this.viewer.fitToView(dbids);
            }
        }
    }

    /**
     * Returns properties pane formatting model content hierarchies, properties and latest formatting values, Then populate properties pane.
     * This method is called once every time we open properties pane or when the user edit any format property. 
     */
    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    private async initializeViewer(): Promise<void> {
        if (this.viewer) {
            throw new Error('Viewer has already been initialized.');
        }
        await initializeViewerRuntime({ getAccessToken: this.getAccessToken });
        this.container.innerHTML = '';
        this.viewer = new Autodesk.Viewing.GuiViewer3D(this.container);
        this.viewer.start();
        this.viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, this.onPropertiesLoaded.bind(this));
        this.viewer.addEventListener(Autodesk.Viewing.ISOLATE_EVENT, this.onIsolationChanged.bind(this));
        this.updateModel();
    }

    private async getAccessToken(callback: (accessToken: string, expiresIn: number) => void): Promise<void> {
        const response = await fetch(this.accessTokenEndpoint);
        if (!response.ok) {
            alert('Could not retrieve share info. Please see console for more details.');
            console.error(await response.json());
        } else {
            const share = await response.json();
            callback(share.access_token, share.expires_in);
        }
    }

    private async updateModel(): Promise<void> {
        if (!this.viewer) {
            return;
        }

        if (this.model && this.model.getData().urn !== this.urn) {
            this.viewer.unloadModel(this.model);
            this.model = null;
            this.externalIdsMap = null;
        }

        if (this.urn) {
            try {
                this.model = await loadModel(this.viewer, this.urn, this.guid);
            } catch (err) {
                alert('Could not load model in the viewer. See console for more details.');
                console.error(err);
            }   
        }
    }

    private async onPropertiesLoaded() {
        this.externalIdsMap = await getExternalIdMap(this.model);
    }

    private async onIsolationChanged() {
        const allExternalIds = this.currentDataView?.table?.rows;
        if (!allExternalIds) {
            return;
        }
        const visibleNodeIds = getVisibleNodes(this.model);
        const selectedExternalIds = await getExternalIds(this.model, visibleNodeIds);
        const selectionIds: powerbi.extensibility.ISelectionId[] = [];
        for (const selectedExternalId of selectedExternalIds) {
            const rowIndex = allExternalIds.findIndex(row => row[0] === selectedExternalId);
            if (rowIndex !== -1) {
                const selectionId = this.host.createSelectionIdBuilder()
                    .withTable(this.currentDataView.table, rowIndex)
                    .createSelectionId();
                selectionIds.push(selectionId);
            }
        }
        this.selectionManager.select(selectionIds);
    }
}
