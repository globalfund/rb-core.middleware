import { BindingKey, CoreBindings } from "@loopback/core";
import { RbCoreMiddlewareComponent } from "./component";
import { Logger } from "winston";

/**
 * Binding keys used by this component.
 */
export namespace RbCoreMiddlewareComponentBindings {
  export const COMPONENT = BindingKey.create<RbCoreMiddlewareComponent>(
    `${CoreBindings.COMPONENTS}.RbCoreMiddlewareComponent`
  );
}

// Create a binding key for the Winston Logger
export const LOGGER_KEY = BindingKey.create<Logger>("logging.logger");
