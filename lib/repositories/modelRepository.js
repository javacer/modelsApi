"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
var _a;
"use strict";
const mobx_1 = require("mobx");
const internals_1 = require("../internals");
const swagger_ts_types_1 = require("swagger-ts-types");
const defaultList = 'all';
let ModelRepository = class ModelRepository extends internals_1.CustomRepository {
    constructor(modelType, modelMetadata, isModel, mainRepository) {
        super(mainRepository);
        this.isModel = isModel;
        this.allModels = new Map();
        this.lists = new Map();
        this.fetchPromises = new Map();
        /**
         * This method initiate List loading and deserializing/denormallizing of all loaded models
         * Invalid models saved to invalidModels array of returned object
         * @param {ModelList<ObservableModel<T extends ModelWithId>> & IObservableObject} list
         */
        this.loadList = (list) => {
            if (this.fetchPromises.has(list)) {
                return this.fetchPromises.get(list); // Buggy TS
            }
            list.loadState = internals_1.LoadState.pending();
            const fetchPromise = this.fetchList(list.name).then((rawModels) => {
                this.consumeModels(rawModels, list);
                this.fetchPromises.delete(list);
                return list;
            }).catch((error) => {
                list.loadState = new internals_1.ErrorState(error);
                this.fetchPromises.delete(list);
                if (!(error instanceof internals_1.CoreError)) {
                    throw error;
                }
            });
            this.fetchPromises.set(list, fetchPromise);
            return fetchPromise;
        };
        mainRepository.registerModelRepository(modelType, this);
        this.modelType = modelType;
        this.modelMetadata = modelMetadata;
    }
    /**
     * The main entry point of obtain a model. It returns existing model, or try to load it via API
     * the method immediately returns observable T model with appropriate loadsState
     * eg, if model is not loaded yet, this method returns {id: id, loadState: LoadState.Pending()}
     * The returned observable object will be changed as soon as value from backend arrive.
     * @param {string} id
     * @return {ObservableValue<T extends ModelWithId>}
     */
    getModel(id, load) {
        return new internals_1.ObservableOptionalModel(this.getRawModel(id, load), this.modelType, this.mainRepository);
    }
    /**
     * If you need raw ObservableModel<Model> without OptionalModel Wrapper,
     * @param {string} id
     * @return {ObservableModel<ModelWithId | T>}
     */
    getRawModel(id, load) {
        // Try to get existing model
        const model = this.getExistingModel(id);
        if (load || (load === void 0 && model._loadState.isNone())) {
            setImmediate(() => this.loadModel(model));
        }
        return model;
    }
    isFullModel(model) {
        return this.isModel(model);
    }
    getMetadata() {
        return this.modelMetadata;
    }
    /**
     * Use this method to create and later save a new model
     * @return {ObservableModel<T extends ModelWithId>}
     */
    createNewModel() {
        return this.createEmptyModel(swagger_ts_types_1.newModelId);
    }
    /**
     * Create or update model.
     * @param {ModelWithId} model - model, which will be full filled with value, but, should not be used further.
     *                              The only usable models should be always obtained via getModel(id)
     * @param saveModel
     * @return {Promise<void>}
     */
    createOrUpdate(model, saveModel) {
        let apiPromise;
        // TODO: add type checking for saveModel and isNewModel
        if (swagger_ts_types_1.isNewModel(model)) {
            apiPromise = this.create(saveModel);
        }
        else {
            apiPromise = this.update(saveModel);
        }
        return apiPromise.then((responseModel) => {
            this.consumeModel(model, responseModel);
            // This model could be already created in repo, in that case we have to copy
            // This is very rare case, when, for instance fresh model arrived via websocket
            const existingModel = this.allModels.get(responseModel.id);
            if (existingModel) {
                if (existingModel !== model) {
                    mobx_1.set(existingModel, model);
                }
            }
            else {
                this.allModels.set(model.id, model);
            }
        }).catch((error) => {
            model._loadState = new internals_1.ErrorState(error);
            throw error;
        });
    }
    deleteModel(model) {
        const realModel = this.allModels.get(model.id);
        if (realModel) {
            realModel._loadState = internals_1.LoadState.pending();
        }
        this.deleteOne(model).then(() => {
            if (realModel) {
                realModel._loadState = internals_1.LoadState.done();
                this.allModels.delete(model.id);
                for (const list of this.lists) {
                    const index = list[1].models.indexOf(realModel);
                    if (index >= 0) {
                        list[1].models.splice(index, 1);
                    }
                }
            }
        }).catch((apiError) => {
            if (realModel) {
                model._loadState = new internals_1.ErrorState(apiError);
            }
            throw apiError;
        });
    }
    getExistingModel(id) {
        const existingModel = this.allModels.get(id);
        if (existingModel) {
            return existingModel;
        }
        const model = this.createEmptyModel(id);
        this.allModels.set(id, model);
        return model;
    }
    /**
     * The main entry point to get list of Models. The method immediately return observable list
     * and if it was not loaded or is not being loaded, starts it's async loading. The returned observable list will
     * change as soon as value from backend arrive.
     * @param {string} name
     * @return {ModelList<ObservableModel<T extends ModelWithId>> & IObservableObject}
     */
    getList(name = defaultList, autoload = true) {
        return this.getListImpl(name, void 0, autoload);
    }
    /**
     * Returns filtered list
     * @param {{safe: Safe}} filter
     * @return {ModelListImpl<ObservableModel<T extends ModelWithId>>}
     */
    getFilteredList(filter) {
        const listName = JSON.stringify(swagger_ts_types_1.serialize(filter, [this.getMetadata()]));
        const all = this.getList();
        const filteredList = new internals_1.FilteredModelListImpl(listName, all, filter);
        return filteredList;
    }
    /**
     * internal use only
     * @param {string} name
     * @param {boolean} autoload
     * @return {ModelListImpl<ObservableModel<T extends ModelWithId>>}
     */
    getListImpl(name = defaultList, filter, autoload = true) {
        const list = this.getExistingListImpl(name, filter);
        if (autoload && list.loadState.isNone()) {
            setImmediate(() => list.loadList());
        }
        return list;
    }
    getExistingList(name = defaultList) {
        return this.getExistingListImpl(name);
    }
    getExistingListImpl(name = defaultList, filter) {
        const existingList = this.lists.get(name);
        if (existingList) {
            return existingList;
        }
        const list = this.createEmptyList(name, filter);
        this.lists.set(name, list);
        return list;
    }
    /**
     * Inner helper, that creates empty model with required Id
     * @param {string} id
     * @return {ObservableModel<T extends ModelWithId>}
     */
    createEmptyModel(id) {
        return mobx_1.observable.object(Object.assign({}, this.modelMetadata.emptyModel, { id, _loadState: internals_1.LoadState.none(), _modelType: this.modelType }));
    }
    /**
     * Inner helper that creates empty model list
     * @param {string} name
     * @return {ModelList<ObservableModel<T extends ModelWithId>> & IObservableObject}
     */
    createEmptyList(name, filter) {
        return new internals_1.ModelListImpl(name, this.loadList, filter);
    }
    /**
     * This method initiate a Model loading and deserializing/denormallizing
     * @param {ObservableModel<T extends ModelWithId>} model
     */
    loadModel(model) {
        if (model._loadState.isPending()) {
            return;
        }
        model._loadState = internals_1.LoadState.pending();
        const fetchPromise = this.fetchModel(model.id);
        if (fetchPromise) {
            fetchPromise.then((rawModel) => {
                this.consumeModel(model, rawModel);
            }).catch((error) => {
                model._loadState = new internals_1.ErrorState(error);
            });
        }
        else {
            // We cannot load single model, load whole list instead
            const list = this.getExistingList();
            list.loadList().then(() => {
                // When loadList is done, it will mark all models as Done as well
                // So if current model state is not Done that means it was not in list came from backend
                if (model._loadState.isPending()) {
                    model._loadState = new internals_1.ErrorState(new internals_1.CoreError(`Model ${this.modelType} ${model.id} was not found on backend in default list`));
                }
            }).catch((apiError) => {
                model._loadState = new internals_1.ErrorState(apiError);
            });
        }
    }
    consumeModels(rawModels, implList) {
        const list = implList || this.getList(defaultList, false);
        const models = [];
        const invalidModels = [];
        for (const index in rawModels) {
            const rawModel = rawModels[index];
            if (swagger_ts_types_1.isModelWithId(rawModel)) {
                const model = this.getExistingModel(rawModel.id);
                const normalizingError = this.mainRepository.denormalizeModel(model, rawModel, this.modelMetadata);
                if (normalizingError) {
                    this.log.debug(`Denormalization error: ${normalizingError.message}`);
                    invalidModels.push(rawModel);
                    model._loadState = new internals_1.ErrorState(normalizingError);
                }
                else {
                    models.push(model);
                    model._loadState = internals_1.LoadState.done();
                }
            }
            else {
                invalidModels.push(rawModel);
            }
        }
        list.loadState = invalidModels.length
            ? new internals_1.ErrorState(new internals_1.CoreError(`${invalidModels.length} invalid models came from backed. ${JSON.stringify(rawModels)}`))
            : internals_1.LoadState.done();
        list.models = mobx_1.observable.array(models);
        list.invalidModels = mobx_1.observable.array(invalidModels);
        list.total = models.length;
    }
    consumeModel(model, rawModel) {
        if (swagger_ts_types_1.isModelWithId(rawModel)) {
            const normalizingError = this.mainRepository.denormalizeModel(model, rawModel, this.modelMetadata);
            if (normalizingError) {
                this.log.debug(`Load model denormalizing error: ${normalizingError.message}`);
                model._loadState = new internals_1.ErrorState(normalizingError);
            }
            else {
                model._loadState = internals_1.LoadState.done();
            }
        }
        else {
            model._loadState = new internals_1.ErrorState(new internals_1.CoreError(`Denormalizing error: model has no id ${JSON.stringify(rawModel)}`));
        }
    }
    getModelType() {
        return this.modelType;
    }
    getMainRepository() {
        return this.mainRepository;
    }
};
__decorate([
    internals_1.inject,
    __metadata("design:type", internals_1.Log)
], ModelRepository.prototype, "log", void 0);
__decorate([
    mobx_1.observable.shallow,
    __metadata("design:type", Map)
], ModelRepository.prototype, "allModels", void 0);
__decorate([
    mobx_1.observable.shallow,
    __metadata("design:type", Map)
], ModelRepository.prototype, "lists", void 0);
ModelRepository = __decorate([
    internals_1.inject,
    __metadata("design:paramtypes", [typeof (_a = typeof ModelTypes !== "undefined" && ModelTypes) === "function" && _a || Object, Object, Function, Object])
], ModelRepository);
exports.ModelRepository = ModelRepository;
