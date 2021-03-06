import * as express from 'express';
import { AuthRepo } from './auth.repository';
import fetch from 'node-fetch';
import { CONFIG } from './config';
import { extractToken } from './utils';
import { Auth } from './auth.model';

export class AuthRouter {

  repo: AuthRepo;
  router: express.Router = express.Router();
  serverConfig: CONFIG.IServerConfig;
  middlewares: {(req, res, next)}[] = [];

  constructor (datas) {
    Object.assign(this, datas);
  }

  async getRoutes() {
    const MIDDLEWARES = [
      ...this.middlewares,
    ];
    return this.router
    /**
    * @api {get} /auth/isauth Get isAuth
    */

    .get('/test', async(req: express.Request, res: express.Response, next: express.NextFunction) => {
      return res.status(200).json({code: 200, message: 'work!'});
    })

    .get('/isauth', MIDDLEWARES, async(req: express.Request, res: express.Response, next: express.NextFunction) => {
      let token: string = extractToken(req);
      // check if for loading user data flag
      if (req.query.loadUserData === undefined)
        return res.status(200).json({token});
      if (!((<any>req).decoded || {})._id)
        return next({code: 401, message: 'No user ID in Token'});
      // build url to request other service
      const url = `${this.serverConfig.gateway_host}/users/${((<any>req).decoded || {})._id}`;
      // TODO: use class with method like `/signin`
      // do request to other microservice and handle props
      const { user, code, message, stack } = await fetch(
        url,
        {
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          'x-access-token': token,
          'x-backend-token': this.serverConfig.backendToken,
        },
      })
      .then(async(response) => await response.json().catch(err => err))
      .catch(err => err);
      // check existing datas form service response
      // and return error message if unexisting
      if (!user)
        return next({code: code || 400, message: message || 'User check failed', stack: user});
      // update token
      token = this.repo.getToken({_id: user.uid, email: user.email, password: ''});
      // return existing datas
      return res.status(200).json({ user, token });
    })

    /**
    * @api {post} /auth Post to authenticate (login)
    */
    .post('/', async(req: express.Request, res: express.Response, next: express.NextFunction) => {
      // handle errors
      if (!req.body.email) {
        return next({code: 400, message: 'Email not provided'});
      }
      if (!req.body.password) {
        return next({code: 400, message: 'Password not provided'});
      }
      const backendToken = this.serverConfig.backendToken;
      // extract datas from repository response
      const {token = null, auth = null}  =  await this.repo.auth(req.body.email, req.body.password)
                                            .catch(err => err);
      // handle unexisting token or datas from repository
      if (!token || !auth)
        return next({code: 400, message: 'Authentication failed no user or token found', stack: {auth, token}});
      // TODO: use class with method like `/signin`
      // do request to other microservice and handle props
      const { user, message, code, stack } = await fetch(`${this.serverConfig.gateway_host}/users/${auth._id}`, {
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          'x-access-token': token,
          'x-backend-token': backendToken,
        },
      })
      .then(async(response) => await response.json().catch(err => err))
      .catch(err => err);
      // check existing datas form service response
      // and return error message if unexisting
      if (!user)
        return next({code: code || 400, message: message || 'Authentication failed', stack});
      // return existing datas
      return res.status(200).json({user, token});
    })

    /**
    * @api {post} /auth/signin Post to create an AuthUser
    */
    .post('/signin', async(req: express.Request, res: express.Response, next: express.NextFunction) => {
      const {email, password} = req.body;
      if (!email || !password)
        return next({code: 400, message: 'Signin failed. Form fiels error'});
      const backendToken = this.serverConfig.backendToken;
      const response = await this.repo.signin({email, password}).catch(err => err);
      const {auth = null, token = null} = response;
      if (!auth || !token) {
        return next(response);
      }
      // use class to create new user
      const newUser = new Auth(req.body);
      // user method to create user data
      // and extract result
      const {user, code, message, stack} = await newUser.createUser(
        Object.assign({}, {uid: auth._id}, req.body),
        this.serverConfig.gateway_host,
        token,
        backendToken
      ).catch(err => err);
      // check if have existing props with value
      if (code && code !== 200)
        return next({code, message, stack});
      // return user object with token
      return res.status(200).json({user, token});
    })

    .put('/:aid', MIDDLEWARES, async(req, res, next) => {
      const result: {auth?: any, user?: any} = {};
      const {auth, user} = req.body;
      const token: string = extractToken(req);
      const backendToken = this.serverConfig.backendToken;
      const requestAuth = await this.repo.update(auth._id, auth).catch(err => err);
      if (!requestAuth.auth)
        return next({code: 400, message: 'User update failed'});
      result.auth = requestAuth.auth;
      // TODO: use class with method like `/signin`
      const requestUser = await fetch(`${this.serverConfig.gateway_host}/users/${user._id}`, {
        method: 'PUT',
        body: JSON.stringify(user),
        headers: {
          'content-type': 'application/json',
          'x-access-token': token || '',
          'x-backend-token': backendToken || '',
        },
      }).catch(err => err);
      if (requestUser.status === 200)
        return next({code: 400, message: 'User update failed', stack: requestUser});
      result.user = await requestUser.json().user;
      return res.status(200).json(result);
    })

    .delete('/:id', MIDDLEWARES, async(req, res, next) => {
      // TODO: delete user data
      await this.repo.delete(req.params.id)
      .then(auth => res.status(200).json({auth: auth.auth}))
      .catch((err) => next({code: 400, message: err.message, stack: err.errorObj}));
    });
  }

}
