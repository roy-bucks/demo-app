import { createController, generateRequiredSchemaItems } from "./helper"
import { FAQModel } from "../models/FAQ.schema"
import { Collection } from "../utilities/database"
import { tokenKey } from "../config"
import { pipe, zip, of, merge } from "rxjs"
import { mergeMap } from "rxjs/operators"
const jwt = require('jsonwebtoken');

const FAQS = new Collection(FAQModel)

const AddFAQOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    'body.Title',
    'body.Content',
    'body.Type'
  ]),
  request_mapper: (req) => req.body,
  processor: pipe(
    mergeMap((props) => {
      return zip(
        of(props),
        FAQS.ADD({
          Title: props.Title,
          Content: props.Content,
          Type: props.Type,
          Date: new Date(),
        })
      )
    }),
    mergeMap(([props,faq]) => {
      return zip(
        of(props),
        FAQS.GET()
      )
    })
  ),
  response_mapper: (req, res) => ([props, faqs]) => {
    res.send({
      message: "Successfully added an FAQ!",
      data: faqs
  })
  }
}

const GetFAQsOperation = {
  request_mapper: (req) => req.body,
  processor: mergeMap((props) => FAQS.GET()),
  response_mapper: (req, res) => (val) => {
    res.send({
      data: val
    })
  }
}


export const AddFAQController = createController(AddFAQOperation)
export const GetFAQsController = createController(GetFAQsOperation)