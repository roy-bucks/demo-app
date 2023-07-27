import { combineLatest, of } from "rxjs";
import { last, map, mergeMap, reduce, tap, toArray } from "rxjs/operators";
import ValidateJs from "validate.js";

ValidateJs.validators.array = (arrayItems, itemConstraints) => {
  const arrayItemErrors = arrayItems.reduce((errors, item, index) => {
    const error = ValidateJs.validate(item, itemConstraints);
    if (error) errors[index] = { error: error };
    return errors;
  }, {});
  return Object.keys(arrayItemErrors).length === 0
    ? null
    : { errors: arrayItemErrors };
};

export const validateOp = (schema, options) =>
  tap((model) => {
    const errors = ValidateJs.validate(model, schema, options);
    if (errors) {
      throw errors;
    }
  });

export const generateRequiredSchemaItems = (props) => {
  return props.reduce(
    (acc, val) => ({ ...acc, [val]: { presence: true } }),
    {}
  );
};

export const getDefaultOperations = () => ({
  request_mapper: (req) => req,
  processor: tap(),
  request_reducer: (acc, val) => val,
  request_reducer_init: () => ({}),
  response_mapper: (req, res, next) => (val) => {
    console.log("Value: ", val);
    res.send(val);
  },
  error_handler: (req, res, next) => (err) => {
    console.log("error");
    console.error("Error: ", err);
    res.status(500).send(err);
  },
  requestValidationSchema: {},
  requestValidationOptions: {},
});

export const createController =
  (createdOperation = {}) =>
  (req, res, next) => {
    const operation = { ...getDefaultOperations(), ...createdOperation };
    of(req)
      .pipe(
        validateOp(
          operation.requestValidationSchema,
          operation.requestValidationOptions
        ),
        map(operation.request_mapper),
        operation.processor,
        reduce(operation.request_reducer, operation.request_reducer_init())
      )
      .subscribe(
        operation.response_mapper(req, res, next),
        operation.error_handler(req, res, next)
      );
  };

export const emitWhenComplete = (source, completionObservable) =>
  source.pipe(
    mergeMap((v) =>
      combineLatest(completionObservable.pipe(toArray()), of(v)).pipe(last())
    )
  );

export const rescale_nav = (Ry = 100, Vt = 0, Vy = 0, index) => {
  // Ry = rescaled value yesterday
  // Vt = value today
  // Vy = value yesterday
  // index = if index = 0 return 100

  let R = 0;
  if (index === 0) return 100;
  if (Ry === 0 && Vt === 0 && Vy === 0) {
    return 100;
  }
  let day_change = Vt / Vy - 1;
  if (isNaN(day_change) || !isFinite(day_change)) {
  }
  if (day_change === 0 && Ry !== 0) {
    return Ry || 100;
  }

  R = Ry * (1 + day_change);
  if (isNaN(R) || !isFinite(R)) {
    return 100;
  }
  return R;
};
