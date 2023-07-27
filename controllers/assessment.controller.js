import { createController, generateRequiredSchemaItems } from "./helper"
import { UserModel } from "../models/user.schema"
import { GoalPlanningModel } from "../models/goal_planning.schema"
import { GpWalkthroughModel } from "../models/gp_walkthrough.schema"
import { AssessmentModel} from "../models/assessment.schema"
import { Collection } from "../utilities/database"
import { tokenKey } from "../config"
import { pipe, zip, of, merge, throwError } from "rxjs"
import { mergeMap } from "rxjs/operators"
import { computeGoal, computeEndingBalances, computeArrayOfPercentiles } from '../utilities/goal_planning'
import { analyzeRiskProfile } from '../utilities/risk_profiling'
import { splitToChunks } from '../utilities'
import { create } from "mathjs/lib/cjs/entry/mainAny"
import { RiskAssessmentQuestions } from "../config/assessment_constant"
import mongoose from "mongoose";
import moment from "moment"
import e from "express"
import { result } from "validate.js"
import { ResultSet } from "mathjs/lib/cjs/entry/pureFunctionsAny.generated"
const jwt = require('jsonwebtoken');

const users = new Collection(UserModel)
const goalplanning = new Collection(GoalPlanningModel)
const GpWalkthrough = new Collection(GpWalkthroughModel)
const assessment = new Collection(AssessmentModel)

const RiskProfilingOperation = {
  // requestValidationSchema: generateRequiredSchemaItems([
  //   'body.score',
  // ]),
  request_mapper: (req) => {
    return {
      body: req.body,
      fk_User: req.middleware_auth._id
    }
  },
  processor: pipe(

    //computer the score
    mergeMap((props) => {

      let score = 0; 
      for(let a=0; a<props.body.length; a++){
        for(let b=0; b<props.body[a].choices.length; b++){
            if(props.body[a].choices[b].selected){
              score+= parseInt(props.body[a].choices[b].point);
            }
        }
      }
      return zip(
        of(score), 
        of(props.fk_User)
      )
    }),

    mergeMap(([score, userId])=>{

      const result = analyzeRiskProfile(score);

      return zip(
        of(userId),
        users.UPDATE({
          identifier: {
            _id: userId
          },
          data: {
            RiskProfile: result.riskprofile,
          }
        }),
        of(result), 
        assessment.ADD({
          fkUser: userId, 
          RiskType: result,
          Date: new Date()
        })
      )
    }),
  ),
  response_mapper: (req, res) => ([props, user, result, save]) => {
    // console.log(result)
    res.send({
      message: "Successful risk assessment!",
      data: result
  })
  }
}

const GoalPlanningOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    'body.Name',
    'body.Amount',
    'body.Frequency',
    'body.RiskType',
    'body.Years',
    'body.Type'
  ]),
  request_mapper: (req) => {
    return {
      ...req.body,
      user: req.middleware_auth
    }
  },
  processor: pipe(
    mergeMap((props) => {
      const result = computeGoal(props.Amount, props.Frequency, props.Years, props.RiskType)
      var n = props.Years
      if(props.Frequency == 'Quarterly')
        n = n*4
      if(props.Frequency == 'Monthly')
        n = n*12
      
      
      var endingBalances = computeEndingBalances(n, parseFloat(result.PMT), props.RiskType, result.IY, props.Frequency)
      var monte_carlo = computeArrayOfPercentiles(endingBalances, props.RiskType, props.Frequency)
      // var monte_carlo_data = computeArrayOfPercentiles(endingBalances, props.RiskType, props.Frequency)
      // var monte_carlo = monte_carlo_data.percentiles
      // var iterations = monte_carlo_data.iteration_collection
      // var returns = monte_carlo_data.return_collection
      return zip(
        of(props),
        goalplanning.ADD({
          fk_User: props.user._id,
          Name: props.Name,
          Type: props.Type,
          PV: props.Amount,
          FV: result.FV,
          PMT: result.PMT,
          IY: result.IY,
          Frequency: props.Frequency,
          RiskType: props.RiskType,
          Years: props.Years,
          EndingBalances: endingBalances,
          MonteCarlo: monte_carlo,
          // Iterations: iterations,
          // Returns: returns,
          Date: new Date(),
        }),
        of(result),
        of(monte_carlo)
      )
    }),
    mergeMap(([props,goal,result, monte_carlo]) => {
      let mcgraph
      if(monte_carlo.length > 6){
        var perChunk = monte_carlo.length/6
        mcgraph = splitToChunks(monte_carlo, perChunk).map((chunk, index) => {
          if(index == 0)
            return {
              low: chunk[0].low,
              mid: chunk[0].mid,
              high: chunk[0].high,
              Date: chunk[0].Date,
            }
          else
            return {
              low: chunk[chunk.length -1].low,
              mid: chunk[chunk.length -1].mid,
              high: chunk[chunk.length -1].high,
              Date: chunk[chunk.length -1].Date,
            }
        })
      }
      else{
        mcgraph = monte_carlo
      }

      goal.MonteCarlo = mcgraph
      

      return zip(
        of(props),
        of(goal),
        of(result),
        goalplanning.GET({
          fk_User: props.user._id
        }),
        of(mcgraph)
      )
    })
  ),
  response_mapper: (req, res) => ([props, goal, result, list, monte_carlo]) => {
    // console.log(result)
    list.map((goal) => {
      if(goal.MonteCarlo.length > 6){
        var perChunk = goal.MonteCarlo.length/6
        goal.MonteCarlo = splitToChunks(goal.MonteCarlo, perChunk).map((chunk, index) => {
          if(index == 0)
            return {
              low: chunk[0].low,
              mid: chunk[0].mid,
              high: chunk[0].high,
              Date: chunk[0].Date,
            }
          else
            return {
              low: chunk[chunk.length -1].low,
              mid: chunk[chunk.length -1].mid,
              high: chunk[chunk.length -1].high,
              Date: chunk[chunk.length -1].Date,
            }
        })
      }
      return goal
    })
    res.send({
      message: "Successful creation of goal!",
      data: goal,
      monte_carlo: monte_carlo,
      list: list
  })
  }
}

const GetGoalsOperation = {
  request_mapper: (req) => {
    var accessor = req.middleware_auth
    if(accessor.UserLevel == 1){
      return {
        fk_User: req.query.fk_User
      }
    }
    else{
      return {
        fk_User: req.middleware_auth._id
      }
    }
  },
  processor: mergeMap(goalplanning.GET),
  response_mapper: (req, res) => (val) => {
    val.map((goal) => {
      if(goal.MonteCarlo.length > 6){
        var perChunk = goal.MonteCarlo.length/6
        goal.MonteCarlo = splitToChunks(goal.MonteCarlo, perChunk).map((chunk, index) => {
          if(index == 0)
            return {
              low: chunk[0].low,
              mid: chunk[0].mid,
              high: chunk[0].high,
              Date: chunk[0].Date,
            }
          else
            return {
              low: chunk[chunk.length -1].low,
              mid: chunk[chunk.length -1].mid,
              high: chunk[chunk.length -1].high,
              Date: chunk[chunk.length -1].Date,
            }
        })
      }
      return goal
    })
    res.send({
      data: val
    })
  }
}

const DeleteGoalOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
      'query._id'
  ]),
  request_mapper: (req) => {
    return {
      ...req.query,
      user: req.middleware_auth
    }
  },
  processor: mergeMap((props) => {
    return of(props).pipe(
      mergeMap(() => goalplanning.DELETE_ONE({_id: props._id})),
      mergeMap(() => goalplanning.GET({fk_User: props.user._id}))
    )
  }),
  response_mapper: (req, res) => (val) => {
    val.map((goal) => {
      if(goal.MonteCarlo.length > 6){
        var perChunk = goal.MonteCarlo.length/6
        goal.MonteCarlo = splitToChunks(goal.MonteCarlo, perChunk).map((chunk, index) => {
          if(index == 0)
            return {
              low: chunk[0].low,
              mid: chunk[0].mid,
              high: chunk[0].high,
              Date: chunk[0].Date,
            }
          else
            return {
              low: chunk[chunk.length -1].low,
              mid: chunk[chunk.length -1].mid,
              high: chunk[chunk.length -1].high,
              Date: chunk[chunk.length -1].Date,
            }
        })
      }
      return goal
    })
    res.send({
      data: val
    })
  }
}

/* this will get the planning type
*/
const GetPlanningTypes = {
  request_mapper: (req) => {
    return {
      data: req.query,
      bank: req.middleware_auth,
    }
  },
  processor:pipe(
    mergeMap((props) => {

      console.log(props); 
      
      const query = {
        Type: props.data.Type,
        Bank_ID: props.bank._id
      }
      return goalplanning.GET(query);
    }),
    mergeMap((res) => {
      if(! res.length){
        return throwError(new Error('NO DATA'))
      }
      return res;
    })
  ),
  response_mapper: (req, res) => (props) => {
      res.send(props)
  },
  error_handler: (_req, res) => (err) => {
      
      let status = 400
      
      if(err.message === "NO DATA"){
        err.message = "No result found!";
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


/* this will get the planning type
*/
const GetPlanningPerUser = {
  request_mapper: (req) => {
    return {
      bank_id: req.bank._id,
      user_id: req.bankUser._id
    }
  },
  processor:pipe(
    mergeMap((props) => {

      console.log(props); 

      const query = {
        Bank_ID: props.bank_id,
        fk_User: props.user_id
      }
      return goalplanning.GET(query);
    }),
    mergeMap((res) => {
      console.log("res: ", res);

      if(! res.length){
        return throwError(new Error('NO DATA'))
      }
      return res;
    })
  ),
  response_mapper: (req, res) => (props) => {
      res.send(props)
  },
  error_handler: (_req, res) => (err) => {
      
      let status = 400
      
      if(err.message === "NO DATA"){
        err.message = "No result found!";
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


const GoalPlanningUpdate = {
  request_mapper: (req) => {
    return {
      bank_id: req.bank._id,
      user_id: req.bankUser._id, 
      body: req.body
    }

  },
  processor:pipe(
    mergeMap((props) => {


      if(typeof props.body.gpId == "undefined"){
        return throwError(new Error('NO DATA'))
      }


      return zip(
        goalplanning.UPDATE({
          identifier: {
            _id: props.body.gpId,
          },
          data: {
            fk_User: props.user_id,
          }
        }),
      )
    }),
  ),
  response_mapper: (req, res) => ([result]) => {


    if(result.nModified){
        res.send({
          success: true, 
          message: "successfully update"
        })
    }
    else{
        res.send({
          code: 400,
          status: "failed",
          message: "Error on payload request"
        })
    }
  },
    error_handler: (_req, res) => (err) => {
      
      let status = 400
      
      if(err.message === "NO DATA"){
        err.message = "No result found!";
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

/* this will return the pagination
*/
const GoalPlanningPage =  {
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      body: req.query
    }
	},
  processor: pipe(
    mergeMap((props) => {

      return zip(
        of(props.body),
        goalplanning.GET_PAGE({
            page: parseInt(props.body.page),
            max: parseInt(props.body.max)
        })
      )
    }),
  ),
  response_mapper: (req,res) => ([props, response]) => {
    console.log("props: ", props);
    console.log("response: ", response);


    res.send({
      page: props.page,
      data: response
    })
  }
}

const getGpWalkthrough = {
    request_mapper: (req) => {
        return req.body;
    },
    processor: pipe(
        mergeMap((props) => {
            return zip(
                of(props),
                GpWalkthrough.GET()
            )
        }),

        mergeMap(([props, check]) =>{

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

const GoalPlannigDelete = {
    request_mapper: (req) => {
        return req.body;
    },
    processor: pipe(
        mergeMap((props) => {
            return zip(
                goalplanning.DELETE({
                  _id: props.gpId,
                })
            )
        }),
    ),
    response_mapper: (req, res) =>  ([result]) => {
        if(result.deletedCount){
          res.send({
            success: true, 
            message: "succesfuly deleted"
          })
        }
        else{
          res.send({
            code: 400,
            status: "failed",
            message: "Error on payload request"
          })
        }
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


//function get the goal planning w/out the fk user
const GetGoalPlanningNoAccount = {
  request_mapper: (req) => {
    return {
      bank: req.middleware_auth
    }
  },
  processor: pipe(
      mergeMap((props) => {
          console.log("get goal planning");
          console.log("props: ", props);
          return zip(
            goalplanning.GET({
              Bank_ID: props.bank.bankId,
            })
          )
      }),
  ),
  response_mapper: (req, res) =>  ([[response]]) => {
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

const getAllGoalPlanningByBank = {

  request_mapper: (req) => {
    return {
      bank: req.middleware_auth
    }
},
processor: pipe(
    mergeMap((props) => {
        return zip(
          goalplanning.GET({
            Bank_ID: props.bank._id
          })
        )
    }),
),
response_mapper: (req, res) =>  ([response]) => {

    console.log("response: ", response);
    res.send({
      success: true, 
      data: response
    });
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

//funciton create a goal planning w/out fk user
const GoalPlannigCreateNoAccount = {
  request_mapper: (req) => {
      return {
        body: req.body,
        bank: req.middleware_auth
      }
  },
  processor: pipe(
      mergeMap((props) => {
          return zip(
            goalplanning.ADD({
              Bank_ID: props.bank._id,
              Name: props.body.Name,
              Type: props.body.Type, 
              PV: props.body.PV, 
              FV: props.body.FV, 
              PMT: props.body.PMT, 
              IY: props.body.IY, 
              Frequency: props.body.Frequency,
              Years: props.body.Years, 
              MonteCarlo: props.body.MonteCarlo, 
              Iterations: props.body.Iterations, 
              Returns: props.body.Returns, 
              EndingBalances: props.body.EndingBalances,
              RiskType: props.body.RiskType,
              Date: moment(),
            })
          )
      }),
  ),
  response_mapper: (req, res) =>  (response) => {

      console.log("response: ", response);
      res.send({
        success: true, 
        message: "successfully saved"
      });
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

const GetAssessmentScoreOperation = {
  request_mapper: (req) => {
      return {
        body: req.query,
      }
  },
  processor: pipe(
      mergeMap((props) => {


          let query = {};
          if(props.body.user)
              query.fk_User = mongoose.Types.ObjectId(props.body.user)
          return zip(
            goalplanning.AGGREGATE( [
                {
                    "$lookup" : {
                        "from" : "goalplanning",
                        "localField" : "goalplanning",
                        "foreignField" : "_id",
                        "as" : "goalplanning"
                    }
                },
                {
                    "$match" : query
                },
                {
                    "$lookup" : {
                        "from" : "user",
                        "localField" : "fk_User",
                        "foreignField" : "_id",
                        "as" : "user"
                    }
                },
                {
                    $project: {
                        _id: 1,
                        fk_User: 1,
                        fk_Transaction: 1,
                        Date: 1,
                        __v: 1,
                        "Name": 1,
                        "Type": 1,
                        "PV": 1,
                        "FV": 1,
                        "PMT": 1,
                        "IY": 1,
                        "Frequency": 1,
                        "RiskType": 1,
                        "Years": 1,
                        "user.Email": 1,
                        "user.AccountNo": 1,
                        "user.FirstName": 1,
                        "user.LastName": 1,
                        "user.MobileNo": 1,
                    }
                }
            ])
          )
      }),
  ),
  response_mapper: (req, res) =>  (result) => {
      res.send({
          data: result
      })
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


//Create Goal planning with account 
const GoalPlanningCreate = {
  request_mapper: (req) => {
      return {
        body: req.body,
        user: req.middleware_auth
      }
  },
  processor: pipe(
      mergeMap((props) => {
          console.log("Creating goal planning");
          console.log("props: ", props);
          return zip(
            goalplanning.ADD({
              fk_User: props.user._id,
              Name: props.body.Name,
              Type: props.body.Type, 
              PV: props.body.PV, 
              FV: props.body.FV, 
              PMT: props.body.PMT, 
              IY: props.body.IY, 
              Frequency: props.body.Frequency,
              Years: props.body.Years, 
              MonteCarlo: props.body.MonteCarlo, 
              Iterations: props.body.Iterations, 
              Returns: props.body.Returns, 
              EndingBalances: props.body.EndingBalances,
              RiskType: props.body.RiskType,
              Date: moment(),
            })
          )
      }),
  ),
  response_mapper: (req, res) =>  (response) => {
      res.send({
        success: true, 
        message: "successfully saved"
      })
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

//Get the goal planning by fk user
const GetGoalPlanning = {

  request_mapper: (req) => {
    return {
      user: req.middleware_auth
    }
  },
  processor: pipe(
      mergeMap((props) => {
          console.log("get goal planning");
          console.log("props: ", props);
          return zip(
            goalplanning.GET({
              fk_User: props.user.fk_User,
            })
          )
      }),
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


const GetAssessmentQuestionsOperation = {
  processor: pipe(
      mergeMap(() => {
        return zip(
          of(RiskAssessmentQuestions)
        )
      }), 
  ),
  response_mapper: (req, res) =>  ([data]) => {
      res.send(data);
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

const GetAssessmentHistoryOperation = {
  request_mapper: (req) => {
    return {
      param: req.query,
      user: req.middleware_auth
    }
  },
  processor: pipe(
      mergeMap((props) => {


      if (typeof props.param.investor_id == "undefined") {
          return throwError(new Error('NOPARAM'))
      }
          return zip(
            assessment.GET({
              fkUser: props.param.investor_id
            })
          )
      }),

      mergeMap(([res])=>{
       let sorted = res.sort((a,b) => Date.parse(new Date(b.Date)) - Date.parse(new Date(a.Date)));

       return zip(
        of(sorted)
       )
      })
  ),
  response_mapper: (req, res) =>  ([response]) => {
      res.send(response);
  },
  error_handler: (_req, res) => (err) => {

      let status = 400
      console.log(err)

      if (err.message === 'NOPARAM') {
          err.message = "No payload found"
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



//Goal planning without Account 
export const CreateGoalPlanningNoAccountController = createController(GoalPlannigCreateNoAccount)
export const GetGoalPlanningNoAccountController = createController(GetGoalPlanningNoAccount)
export const GetallGPController = createController(getAllGoalPlanningByBank); 

//Goal Planning with Account 
export const CreateGoalPlanningController = createController(GoalPlanningCreate); 
export const GetGoalPlanningController = createController(GetGoalPlanning); 

export const GetUserGoalPlanning = createController(GetPlanningPerUser)
export const TypesGoalPlanningController = createController(GetPlanningTypes)
export const UpdateGoalPlanningController = createController(GoalPlanningUpdate)
export const DeleteGoalController = createController(GoalPlannigDelete)

export const RiskProfilingController = createController(RiskProfilingOperation)
export const GoalPlanningController = createController(GoalPlanningOperation)
export const PageGoalPlanningController = createController(GoalPlanningPage)
export const getGpWalkthroughController = createController(getGpWalkthrough)
export const GetAssessmentScoreController = createController(GetAssessmentScoreOperation)
export const GetAssessmentQuestionsController = createController(GetAssessmentQuestionsOperation)
export const GetAssessmentHistoryController = createController(GetAssessmentHistoryOperation);
