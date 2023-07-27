import { createController, generateRequiredSchemaItems } from "./helper"
import { KYCModel } from "../models/kyc.schema"
import { UserModel } from "../models/user.schema"
import { Collection } from "../utilities/database"
import { tokenKey } from "../config"
import { pipe, zip, of, merge, from, throwError } from "rxjs"
import { mergeMap } from "rxjs/operators"
import { generateID } from '../utilities/security'
import {
  submitID,
  selfieAPI,
  livenessDetection,
  createJourneyID,
  centralizeOkayFace,
  centralizeOkayId,
  freeFormID,
  analyzeFaceResult,
  getAuthorizationLink,
  getAccessToken,
  verifyAccount,
  verifyGender,
  verifyBirthday
 } from '../utilities/kyc'
import { parseForm, compareStrings, formatDatev2 } from '../utilities'
import { mapID, compareFields, compareFields_FreeForm } from '../utilities/id_mapper'
import { uploadFile, base64ToBuffer } from '../utilities/upload'
import mongoose from "mongoose"
import { query } from "express"
var fs = require('fs');

const jwt = require('jsonwebtoken');

const users = new Collection(UserModel)
const kyc = new Collection(KYCModel)


const GetJourneyIDOperation = {
  request_mapper: (req) => {
    return {
      fk_User: req.middleware_auth._id
    }
  },
  processor: mergeMap((props) => createJourneyID()),
  response_mapper: (req, res) => (val) => {
    res.send({
      data: val
    })
  }
}

const SubmitPersonalInfoStep1Operation = {
  requestValidationSchema: generateRequiredSchemaItems([
    'body.Address',
  ]),
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      data: req.body
    }
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        of(props.user._id),
        users.UPDATE({
          identifier: {
            _id: props.user._id
          },
          data: {
            ...props.data
          }
        }),
        kyc.UPDATE({
          identifier: {
            fk_User: props.user._id,
            nextTier: 2
          },
          data: {
            passedPersonalInfo: true,
            passedIDVerification: false,
            passedSelfieVerification: false,
            passedSignatures: false,
            Date: new Date(),
            currentTier: props.user.Tier,
            nextTier: 2,
            personalInfo_Verification: props.data
          }
        })
      )
    }),
    mergeMap(([_id,update_status]) => users.GET({_id: _id}))
  ),
  response_mapper: (req, res) => (result) => {
    // console.log(result)
    res.send({
      code: 200,
      data: result
  })
  }
}

const SubmitPersonalInfoStep2Operation = {
  requestValidationSchema: generateRequiredSchemaItems([
    'body.SourceOfIncome',
    'body.NatureOfWork',
    'body.NameOfEmployer',
    'body.OfficeAddress',
  ]),
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      data: req.body
    }
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        of(props.user._id),
        users.UPDATE({
          identifier: {
            _id: props.user._id
          },
          data: {
            ...props.data
          }
        }),
        kyc.UPDATE({
          identifier: {
            fk_User: props.user._id,
            nextTier: 2
          },
          data: {
            passedPersonalInfo: true,
            Date: new Date(),
            currentTier: props.user.Tier,
            nextTier: 2,
            personalInfo_Verification: props.data
          }
        })
      )
    }),
    mergeMap(([_id,update_status]) => users.GET({_id: _id}))
  ),
  response_mapper: (req, res) => (result) => {
    // console.log(result)
    res.send({
      code: 200,
      data: result
  })
  }
}

const SubmitFreeFormIDOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    'body.TypeOfID',
    'body.Image',
  ]),
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      data: req.body
    }
  },
  processor: pipe(
    mergeMap((props) => {
      let data
      return of(data).pipe(
        mergeMap(() => {
          return users.UPDATE({
            identifier: {
              _id: props.user._id,
            },
            data: {
              TypeOfID: props.data.TypeOfID,
            }
          })
        }),
        mergeMap(() => users.GET_ONE({_id: props.user._id})),
        mergeMap(() => freeFormID({
          Image: props.data.Image,
        })),
        mergeMap(result => {
          if(!result.IsErroredOnProcessing){
            var mapped_data = compareFields_FreeForm(result.fields, props.user)
            if(mapped_data.hasMatches){
              return of(mapped_data)
            }
            else{
              return throwError(new Error("NO MATCHES FOUND"))
            }
          }
          else{
            // console.log(result)
            return throwError(new Error("ID VERIFICATION FAILED"))
          }
        }),
        mergeMap((data) => {
          return zip(
            kyc.UPDATE({
              identifier: {
                fk_User: props.user._id,
                nextTier: 2
              },
              data: {
                passedIDVerification: true,
                id_Verification: {
                  TypeOfID: props.data.TypeOfID,
                  Image: "/image/path/here",
                  Result: data
                }
              }
            }),
            of(data)
          )
        }),
        mergeMap(([temp,data]) => {
          return of(data)
        })
      )
    }),
  ),
  response_mapper: (req, res) => (result) => {
    res.send({
      code: 200,
      message: "Successful ID Verification",
      status: "success",
      data: result
  })
  },
  error_handler: (_req, res) => (err) => {
    let status = 500
    

    if(err.message == "NO MATCHES FOUND"){
      status = 400
    }

    if(err == 'UNRECOGNIZED_IMAGE'){
      status = 406
    }

    if(err.message == "ID VERIFICATION FAILED"){
      status = 400
    }

    console.log(err)
    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message
    })
  }
}

const SubmitIDOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    'body.JourneyID',
    'body.TypeOfID',
    'body.IDNumber',
    'body.ExpirationOfID',
    'body.Image',
    'body.Format',
  ]),
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      data: req.body
    }
  },
  processor: pipe(
    mergeMap((props) => {
      let data
      return of(data).pipe(
        mergeMap(() => {
          return users.UPDATE({
            identifier: {
              _id: props.user._id
            },
            data: {
              TypeOfID: props.data.TypeOfID,
              IDNumber: props.data.IDNumber,
              ExpirationOfID: props.data.ExpirationOfID
            }
          })
        }),
        mergeMap(() => users.GET_ONE({_id: props.user._id})),
        mergeMap((user) => {
          props.user = user;
          return centralizeOkayId({
            JourneyID: props.data.JourneyID,
            Image: props.data.Image,
            Format: props.data.Format.split('/')[1]
          })
        }),
        mergeMap(result => {
          if(result.status === 'success'){
            var mapped_data = mapID(result.documentType,result.fields)
            var compared_data = compareFields(props.data.TypeOfID, mapped_data, props.user)
            if(compared_data.length == 0){
              return of([mapped_data])
            }
            else {
              var errors = {
                isError: true,
                error_list: compared_data
              }
              return throwError(new Error(JSON.stringify(errors)))
            }

          }
          else{
            return throwError(new Error(result.message))
          }
        }),
        mergeMap((data) => {
          return zip(
            kyc.UPDATE({
              identifier: {
                fk_User: props.user._id,
                nextTier: 2
              },
              data: {
                passedIDVerification: true,
                id_Verification: {
                  TypeOfID: props.data.TypeOfID,
                  Image: "/image/path/here",
                  Result: data[0]
                }
              }
            }),
            of(data)
          )
        }),
        mergeMap(([temp,data]) => {
          return of(data)
        })
      )
    }),
  ),
  response_mapper: (req, res) => (result) => {
    res.send({
      code: 200,
      message: "Successful ID Verification",
      status: "success",
      data: result
  })
  },
  error_handler: (_req, res) => (err) => {
    let status = 500
    try{
      var results = JSON.parse(err.message)
      if(results.isError){
        status = 400
      }
      if(results.error_list.indexOf('ID TYPE DOES NOT MATCH') != -1)
        status = 417
      res.status(status).json({
        code: status,
        status: "failed",
        message: "NO MATCHES FOUND",
        ...results
      })
    }
    catch(e){
      console.log(err)
      
      if(err.message == 'UNRECOGNIZED_IMAGE'){
        status = 406
      }

      if(err.message == 'ID TYPE DOES NOT MATCH'){
        status = 417
      }

      res.status(status).json({
        code: status,
        status: "failed",
        message: err.message
      })
    }
  }
}

const SelfieAPIOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    'body.JourneyID',
    'body.Image_Selfie',
    'body.Image_ID'
  ]),
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      data: req.body
    }
  },
  processor: pipe(
    mergeMap((props) => {
      return of(props).pipe(
        mergeMap((props) => centralizeOkayFace({
          JourneyID: props.data.JourneyID,
          Image_Selfie: props.data.Image_Selfie,
          Image_ID: props.data.Image_ID
        })),
        mergeMap((result) => {
          if(result.status === 'success'){
            var analyzedResult = analyzeFaceResult(result)
            if(analyzedResult.isSuccessful){
              return of([analyzedResult])
            }
            else{
              return throwError(new Error(JSON.stringify(analyzedResult)))
            }
          }
          else{
            // console.log(result)
            return throwError(new Error(result.message))
          }
        }),
        mergeMap((data) => {
          return of(data).pipe(
            mergeMap(() => {
              const selfie = {
                path: `user/${props.user._id}/kyc/selfie.jpg`,
                body: base64ToBuffer(props.data.Image_Selfie)
              };
              const image_id = {
                path: `user/${props.user._id}/kyc/id.jpg`,
                body: base64ToBuffer(props.data.Image_ID)
              };
              return zip(
                uploadFile(selfie),
                uploadFile(image_id),
                kyc.GET_ONE({fk_User: props.user._id, nextTier: 2})
              )
            }),
            mergeMap(([selfie, image_id, kyc_data]) => {
                return zip(
                  kyc.UPDATE({
                    identifier: {
                      fk_User: props.user._id,
                      nextTier: 2
                    },
                    data: {
                      passedSelfieVerification: true,
                      selfie_Verification: {
                        Image_Selfie: selfie.path,
                        Image_ID: image_id.path,
                        Result: data[0]
                      },
                      id_Verification: {
                        TypeOfID: kyc_data.id_Verification.TypeOfID,
                        Image: image_id.path
                      }
                    }
                  }),
                  of(data)
                )
            })
          )
          

        }),
        mergeMap(([temp,data]) => {
          return of(data)
        })
      )
    }),
  ),
  response_mapper: (req, res) => (result) => {
    console.log(result)
    res.send({
      code: 200,
      status: "success",
      data: result
    })
  },
  error_handler: (_req, res) => (err) => {
    let status = 500
    console.log(err)

    try{
      var results = JSON.parse(err.message)
      if(!results.isSuccessful){
        status = 400
      }
      res.status(status).json({
        code: status,
        status: "failed",
        message: "NO MATCHES FOUND",
        ...results
      })
    }
    catch(e){
      
      if(err.message === 'FACE_NOT_FOUND'){
        status = 406
      }

      res.status(status).json({
        code: status,
        status: "failed",
        message: err.message
      })
    }
  }
}

const SubmitSignatureOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    'body.Signature1',
    'body.Signature2',
    'body.Signature3'
  ]),
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      data: req.body
    }
  },
  processor: pipe(
    mergeMap((props) =>
    of(props).pipe(
      mergeMap(() => {
        const signature1 = {
          path: `user/${props.user._id}/kyc/signature1.jpg`,
          body: base64ToBuffer(props.data.Signature1)
        };
        const signature2 = {
          path: `user/${props.user._id}/kyc/signature2.jpg`,
          body: base64ToBuffer(props.data.Signature2)
        }
        const signature3 = {
          path: `user/${props.user._id}/kyc/signature3.jpg`,
          body: base64ToBuffer(props.data.Signature3)
        }
        return zip(
          uploadFile(signature1),
          uploadFile(signature2),
          uploadFile(signature3),
        )
      }),
      mergeMap(([path1, path2, path3]) => {
        // fs.writeFile('signature1.txt', props.data.Signature1, function (err) {
        //   if (err) throw err;
        //   console.log('Saved!');
        // });
        return zip(
          kyc.UPDATE({
            identifier: {
              fk_User: props.user._id,
              nextTier: 2
            },
            data: {
              passedSignatures: true,
              signatures: {
                Signature1: path1.path,
                Signature2: path2.path,
                Signature3: path3.path,
              }
            }
          }),
          of(props)
        )
      }),
    )),
    mergeMap(([temp, props]) => {
      let data
      return of(data).pipe(
        mergeMap(() => kyc.GET_ONE({fk_User: props.user._id, nextTier: 2})),
        mergeMap((kyc_data) => {
          if(kyc_data.passedPersonalInfo && kyc_data.passedIDVerification && kyc_data.passedSelfieVerification && kyc_data.passedSignatures){
            return users.UPDATE({
              identifier: {
                _id: props.user._id
              },
              data: {
                Tier: kyc_data.nextTier
              }
            })
          }
          else{
            return throwError(new Error("TIER UPGRADE FAILED"))
          }
        })
      )
    })
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      code: 200,
      status: 'success',
    })
  },
  error_handler: (_req, res) => (err) => {
    let status = 500

    if(err.message === 'TIER UPGRADE FAILED'){
      status = 400
    }

    console.log(err)
    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message
    })
  }
}




const LivenessDetectionOperation = {
  request_mapper: (req) => {
    return req
  },
  processor: pipe(
    mergeMap((req) => {
      return zip(
        parseForm(req),
        of(req.middleware_auth)
      )
    }),
    mergeMap(([data,user]) => livenessDetection({
      AccountNo: user.AccountNo,
      ...data
    })),
    mergeMap(result => {
      if(result.statusCode === 200){
        if(result.body.Match === 'No'){
          return throwError(new Error('No match'))
        }
        else{
          if(result.body.LivenessDetection == 'Failed'){
            return throwError(new Error('Liveness Detection failed'))
          }
          else{
            return of(result)
          }
        }
      }
      else{
        return throwError(new Error('Verification failed'))
      }
    })
  ),
  response_mapper: (req, res) => (result) => {
    console.log(result)
    res.send({
      code: 200,
      data: result
  })
  },
  error_handler: (_req, res) => (err) => {
    let status = 500

    if(err.message === 'No match') {
      status = 404
    }

    if(err.message === 'Verification failed') {
      status = 404
    }

    console.log(err)
    res.status(status).json({
      message: err.message
    })
  }
}


//TIER 3 APIs


const getAuthorizationOperation = {
  response_mapper: (req, res) => (val) => {
    res.send({
      code: 200,
      status: 'success',
      link: getAuthorizationLink()
    })
  }
}

const verifyUBAccountOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    'body.UBAccountNo',
    'body.AuthorizationCode'
  ]),
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      data: req.body
    }
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        getAccessToken(props.data.AuthorizationCode),
        of(props)
      )
    }),
    mergeMap(([token,props]) => {
      // var token = {
      //   access_token: 'AAIkZTI4NDU5MzMtMzY1OC00OTFiLWE5MTItMzkyOGQxNTc0OGVi5MbpTdc9sK34PP9prBmrM4p0TjSn7OzQ8Q3ahRpwugHABrZ-Q2tAAeEy6nfnxOejhKs1kolSSWwCK5mB3aysJDMoYgm8WYzNBfIEwdWOEEOBi2h1k0JGimSOC8_i28E4bxqlueQvNVOoYhZ4oueJLn4LyGAbbxNauoK8ZufHvEVbv04_zRp8JD1LJKlPKyWrdx7os2jfvEXcyq-GreWSjH5zA50w3d9z9p2jZkzgrxfTL04m6UpTg_fKkB2r-OKf4vOM3r5GB-uKgK0KA51vcvxIYmFObUjMdoK8S_KncN8LdmtPjHO7dSLJ8FUSEjn9X5xjv6Kbz7fr03mpO8RD14_WzGu0cgcHSggNvSoPPj86J3e4yM3W4VvAHng77OpZ'
      // }
      var senderRefId = 'BXBT3' + generateID(2).toUpperCase()
      let data
      return of(data).pipe(
        mergeMap(() => verifyAccount({
          UBAccountNo: props.data.UBAccountNo,
          FullName: `${props.user.FirstName} ${props.user.MiddleName} ${props.user.LastName}`,
          accessToken: token.access_token,
          senderRefId: senderRefId
        })),
        mergeMap((account_verification) => {
          if(account_verification){
            return verifyGender({
              Gender: props.user.Gender,
              accessToken: token.access_token,
              senderRefId: senderRefId
            })
          }
          else{
            return throwError(new Error('VERIFICATION FAILED'))
          }
        }),
        mergeMap((gender_verification) => {
          if(gender_verification){
            return verifyBirthday({
              DateOfBirth: formatDatev2(props.user.DateOfBirth),
              accessToken: token.access_token,
              senderRefId: senderRefId
            })
          }
          else{
            return throwError(new Error('VERIFICATION FAILED'))
          }
        }),
        mergeMap((birthday_verification) => {
          if(birthday_verification){
            return kyc.UPDATE({
              identifier: {
                fk_User: props.user._id,
                nextTier: 3
              },
              data: {
                Date: new Date(),
                currentTier: props.user.Tier,
                nextTier: 3,
                UB_Verification: {
                  verifyAccount: true,
                  verifyGender: true,
                  verifyBirthday: true,
                  UBAccountNo: props.data.UBAccountNo
                }
              }
            })
          }
          else{
            return throwError(new Error('VERIFICATION FAILED'))
          }
        }),
        mergeMap(() => kyc.GET_ONE({fk_User: props.user._id, nextTier: 3})),
        mergeMap((kyc_data) => users.UPDATE({
          identifier: {
            _id: props.user._id
          },
          data: {
            Tier: kyc_data.nextTier
          }
        }))
      )
    }),
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      code: 200,
      status: 'success'
    })
  },
  error_handler: (_req, res) => (err) => {
    let status = 500

    if(err.message === 'VERIFICATION FAILED'){
      status = 400
    }

    console.log(err)
    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message
    })
  }
}

const handleUBPostbackOperation = {
  request_mapper: (req) => {
    if(req.body.txnid !== undefined){
      console.log('POST:: FROM POSTBACK UB')
      var data = req.body
    }
    else{
      console.log('GET:: FROM RETURN URL UB')
      var data = req.query
    }
    // console.log(data)
    return data

  },
  processor: mergeMap((props) => {
    return of(props)
  }),
  response_mapper: (req, res) => (val) => {
    res.send("result=OK")
  }
}

const getKYCDataOperation = {
  request_mapper: (req) => {
    var accessor = req.middleware_auth
    return {
      fk_User: req.query.fk_User,
      user: accessor
    }
  },
  processor: mergeMap((query) => {
    return of(query).pipe(
      mergeMap(() => {
        if(query.user.UserLevel != 1){
          return throwError(new Error("UNAUTHORIZED"))
        }
        else{
          return of(query)
        }
      }),
      mergeMap(() => {
        return kyc.AGGREGATE([
          { $sort: { Date: -1}},
          {
            $lookup:
            {
              from: 'user',
              localField: 'fk_User',
              foreignField: '_id',
              as: 'user'
            }
          },
          { $unwind: '$user'},
          {
            $project: {
              _id: 0,
              fk_User: 1,
              currentTier: 1,
              nextTier: 1,
              passedIDVerification: 1,
              passedPersonalInfo: 1,
              passedSelfieVerification: 1,
              passedSignatures: 1,
              id_Verification: 1,
              selfie_Verification: 1,
              personalInfo_Verification: 1,
              UB_Verification: 1,
              signatures: 1,
              Date: 1,
              "user.AccountNo": 1,
              "user.FirstName": 1,
              "user.LastName": 1,
              "user.Email": 1,
              "user.MobileNo": 1,
            }
          },
        ])
      }),
    )
  }),
  response_mapper: (req, res) => (val) => {
      // console.log(val)
      res.send({
          data: []
      })
      // res.send({
      //     data: val
      // })
  },
  error_handler: (_req, res) => (err) => {
    let status = 500
    

    if(err.message == "UNAUTHORIZED"){
      status = 403
    }

    console.log(err)
    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message
    })
  }
}

export const GetJourneyIDController = createController(GetJourneyIDOperation)
export const SubmitIDController = createController(SubmitIDOperation)
export const SubmitFreeFormIDController = createController(SubmitFreeFormIDOperation)
export const SelfieAPIController = createController(SelfieAPIOperation)
export const SubmitPersonalInfoStep1Controller = createController(SubmitPersonalInfoStep1Operation)
export const SubmitPersonalInfoStep2Controller = createController(SubmitPersonalInfoStep2Operation)
export const SubmitSignatureController = createController(SubmitSignatureOperation)
// export const LivenessDetectionController = createController(LivenessDetectionOperation)
export const handleUBPostbackController = createController(handleUBPostbackOperation)
export const getAuthorizationController = createController(getAuthorizationOperation)
export const verifyUBAccountController = createController(verifyUBAccountOperation)
export const getKYCDataController = createController(getKYCDataOperation)
