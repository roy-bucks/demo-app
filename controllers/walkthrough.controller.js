import { createController, generateRequiredSchemaItems } from "./helper"
import { WalkthroughModel } from "../models/walkthrough.schema"
import { Collection } from "../utilities/database"
import { tokenKey } from "../config"
import { pipe, zip, of, merge, throwError } from "rxjs"
import { mergeMap } from "rxjs/operators"
import mongoose from "mongoose"
import { create } from "mathjs/lib/cjs/entry/mainAny"
import moment from 'moment'


const walkthrough = new Collection(WalkthroughModel)


const createWalkthrough = {
    request_mapper: (req) => {
       return req.body;  

       //add the validatin here
       //return throwError(new Error('message'))
    },
    processor: pipe(

      mergeMap((props) => {
            return zip (
                of(props),
                walkthrough.GET({Page: props.Page})
            )
      }), 
      mergeMap(([props, check]) => {

            if(check.length){
                return throwError(new Error('PAGE EXIST'))
            }

            return zip(
                of(props),
                walkthrough.ADD({
                    Page: parseInt(props.Page), 
                    Title: props.Title, 
                    Content: props.Content, 
                    Active: props.Active, 
                    Image: props.Image, 
                    UpdatedAt: moment().format('YYYY-MM-DD'),
                    CreatedAt: moment().format('YYYY-MM-DD')
                }),
            )
        }), 
        mergeMap(([props, check])=>{
            return zip(
                walkthrough.GET({})
            )
        })
    ),
    response_mapper: (req, res) =>  (response) => {
        res.send({
            data: response 
        })
    },
    error_handler: (_req, res) => (err) => {
            
        let status = 400
        console.log(err)

        if(err.message === "PAGE EXIST"){
            err.message = "This page already exist"
        }
        else if (err.message === 'UNAUTHORIZED') {
            status = 403
        } else {
            err.message = 'Something went wrong'
        }
        
        res.status(status).json({
            code: status,
            status: "failed",
            message: err.message
        })
    }
}


const updateWalkthrough = {

    request_mapper: (req) => {
        return req.body;  
     },
     processor: pipe(
        mergeMap((props) => {

            console.log("props: ", props); 

             return zip(
                 of(props),
                 walkthrough.GET({Page: props.Page})
             )
         }),
        mergeMap(([props, check]) => {

            if(!check.length)
                return throwError(new Error('PAGE NOT EXIST'))

             return zip(
                 of(check[0]),
                 walkthrough.UPDATE({
                    identifier: {
                        _id: check[0]._id
                    },
                    data: {
                        Page: props.Page,
                        Title: props.Title,
                        Content: props.Content,
                        Active: props.Active,
                        Image: props.Image,
                        UpdatedAt: moment().format('YYYY-MM-DD'),
                    }
                 })
             )
         }),
         mergeMap(([check, res]) => {
            console.log("check; ", check); 
            return zip(
                walkthrough.GET({_id: check._id})
            )
         })
     ),
     response_mapper: (req, res) =>  (response) => {
         res.send(response);
     },
     error_handler: (_req, res) => (err) => {
             
         let status = 400
         console.log(err)

         if(err.message == "PAGE NOT EXIST"){
            err.message = "PAGE NOT EXIST"
         }
         else if (err.message === 'UNAUTHORIZED') {
             status = 403
         } else {
             err.message = 'Something went wrong'
         }
         
         res.status(status).json({
             code: status,
             status: "failed",
             message: err.message
         })
     }
}

const getWalkthrough = {

    request_mapper: (req) => {
        return req.body;  
     },
     processor: pipe(
        mergeMap((props) => {
             return zip(
                 walkthrough.GET({})
             )
         }),

         mergeMap((check) =>{

            if(check.length){
               return check;
            }
            else{
                return throwError(new Error('No Data Found')); 
            }
         })
     ),
     response_mapper: (req, res) =>  (response) => {
         res.send(response);
     },
     error_handler: (_req, res) => (err) => {

         let status = 400
         console.log(err)
         
         if (err.message === 'UNAUTHORIZED') {
             status = 403
         } else {
             err.message = 'Something went wrong'
         }
         
         res.status(status).json({
             code: status,
             status: "failed",
             message: err.message
         })
     }
}



export const createWalkthroughController = createController(createWalkthrough); 
export const updateWalkthroughController = createController(updateWalkthrough); 
export const getWalkthroughController = createController(getWalkthrough); 

