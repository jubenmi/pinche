export function __decorate(decorators, target, key, desc) {
  var c = arguments.length;
  var r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc;
  var d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") {
    r = Reflect.decorate(decorators, target, key, desc);
  } else {
    for (var i = decorators.length - 1; i >= 0; i -= 1) {
      if (d = decorators[i]) {
        r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
      }
    }
  }
  if (c > 3 && r) {
    Object.defineProperty(target, key, r);
  }
  return r;
}

export function __awaiter(thisArg, args, PromiseCtor, generator) {
  function adopt(value) {
    return value instanceof PromiseCtor ? value : new PromiseCtor(function (resolve) {
      resolve(value);
    });
  }
  return new (PromiseCtor || (PromiseCtor = Promise))(function (resolve, reject) {
    function fulfilled(value) {
      try {
        step(generator.next(value));
      } catch (error) {
        reject(error);
      }
    }
    function rejected(value) {
      try {
        step(generator.throw(value));
      } catch (error) {
        reject(error);
      }
    }
    function step(result) {
      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
    }
    step((generator = generator.apply(thisArg, args || [])).next());
  });
}
