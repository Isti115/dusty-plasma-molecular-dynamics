import Particle from './Particle.js'

import * as utilities from './utilities.js'
import * as physics from './physics.js'

export default class Simulation {
  constructor (
    size,
    gridCount,
    particleCount,
    gamma,
    kappa,
    pairCorrelationResolution
  ) {
    this.size = size
    this.gridCount = gridCount
    this.particleCount = particleCount
    this.gamma = gamma
    this.kappa = kappa
    this.pairCorrelationResolution = pairCorrelationResolution

    this.init = this.init.bind(this)
    this.initPairCorrelation = this.initPairCorrelation.bind(this)
    this.placeParticles = this.placeParticles.bind(this)
    this.makeGrid = this.makeGrid.bind(this)
    this.processParticleWithCellFromIndex = (
      this.processParticleWithCellFromIndex.bind(this)
    )
    this.calculateForces = this.calculateForces.bind(this)
    this.updateSpeed = this.updateSpeed.bind(this)
    this.updatePosition = this.updatePosition.bind(this)
    this.randomMove = this.randomMove.bind(this)
    this.update = this.update.bind(this)

    this.init()
  }

  init () {
    this.placeParticles()
    this.makeGrid()

    this.stepCount = 0
    this.kineticEnergy = 0
    this.initPairCorrelation()
  }

  initPairCorrelation () {
    this.pairCorrelationData = utilities.generateArray(this.pairCorrelationResolution, () => 0)
  }

  placeParticles () {
    this.particles = utilities.generateArray(
      this.particleCount,
      () => Particle.randomParticle(this.size)
    )

    // const p1 = new Particle()
    // p1.position = { x: 0.0049, y: 0.005 }

    // const p2 = new Particle()
    // p2.position = { x: 0.0051, y: 0.005 }

    // this.particles = [ p1, p2 ]
  }

  makeGrid () {
    this.grid = utilities.generateArray(
      this.gridCount.y,
      () => utilities.generateArray(this.gridCount.x, () => [])
    )

    this.particles.forEach(p => {
      const cell = {
        x: Math.floor(p.position.x / (this.size.x / this.gridCount.x)),
        y: Math.floor(p.position.y / (this.size.y / this.gridCount.y))
      }

      this.grid[cell.y][cell.x].push(p)
    })
  }

  processParticleWithCellFromIndex (currentParticle, cell, fromIndex) {
    const overflow = {
      x: cell.x < 0 ? -1 : cell.x > this.gridCount.x - 1 ? 1 : 0,
      y: cell.y < 0 ? -1 : cell.y > this.gridCount.y - 1 ? 1 : 0
    }

    const boundedCell = {
      x: cell.x - overflow.x * this.gridCount.x,
      y: cell.y - overflow.y * this.gridCount.y
    }

    const currentOtherCell = this.grid[boundedCell.y][boundedCell.x]

    for (
      let otherParticleIndex = fromIndex;
      otherParticleIndex < currentOtherCell.length;
      otherParticleIndex++
    ) {
      const currentOtherParticle = currentOtherCell[otherParticleIndex]

      const offset = {
        x: currentParticle.position.x - (
          currentOtherParticle.position.x + (this.size.x * overflow.x)
        ),
        y: currentParticle.position.y - (
          currentOtherParticle.position.y + (this.size.y * overflow.y)
        )
      }

      const distance = utilities.norm(offset.x, offset.y)

      if (distance < physics.CutoffDistance) {
        this.pairCorrelationData[Math.floor((distance / physics.CutoffDistance) * this.pairCorrelationResolution)] += 1 / (distance ** 2)

        const lambdaD = physics.WignerSeitzRadius / this.kappa

        const force = (
          (physics.ParticleCharge ** 2) / (
            4 * Math.PI * physics.VacuumPermittivity
          )
        ) * (
          (1 / (distance ** 2)) + (1 / (distance * lambdaD))
        ) * (
          Math.exp(-distance / lambdaD)
        )

        // 1e10 * (1 / (distance ** 2) + 1 / distance) * Math.exp(-distance) / distance

        const directionalForce = {
          x: (offset.x / distance) * force,
          y: (offset.y / distance) * force
        }

        currentParticle.force.x += directionalForce.x
        currentParticle.force.y += directionalForce.y

        currentOtherParticle.force.x -= directionalForce.x
        currentOtherParticle.force.y -= directionalForce.y
      }
    }
  }

  calculateForces () {
    this.particles.forEach(p => {
      p.previousForce = p.force
      p.force = { x: 0, y: 0 }
    })

    for (let x = 0; x < this.gridCount.x; x++) {
      for (let y = 0; y < this.gridCount.y; y++) {
        for (
          let particleIndex = 0;
          particleIndex < this.grid[y][x].length;
          particleIndex++
        ) {
          const currentParticle = this.grid[y][x][particleIndex]

          this.processParticleWithCellFromIndex(
            currentParticle, { x, y }, particleIndex + 1
          )

          /* eslint-disable */
          const neighbours = [
            { x: x - 1, y: y - 1 },
            { x,        y: y - 1 },
            { x: x - 1, y        },
            { x: x - 1, y: y + 1 }
          ]
          /* eslint-enable */

          neighbours.forEach(n => {
            this.processParticleWithCellFromIndex(currentParticle, n, 0)
          })
        }
      }
    }
  }

  updateSpeed (dt) {
    this.kineticEnergy = physics.ParticleMass * this.particles.map(
      p => (utilities.norm(p.velocity.x, p.velocity.y) ** 2)
    ).reduce((a, b) => a + b, 0) / 2

    const desiredTemperature = (
      (physics.ParticleCharge ** 2) /
      (
        4 * Math.PI * physics.VacuumPermittivity *
        physics.WignerSeitzRadius *
        physics.BoltzmannConstant *
        this.gamma
      )
    )

    const measuredTemperature = (
      this.kineticEnergy /
      (physics.BoltzmannConstant * this.particleCount)
    )

    const dampening = (
      measuredTemperature !== 0
        ? Math.sqrt(desiredTemperature / measuredTemperature)
        : 1
    )

    // const dampening = (
    //   measuredTemperature > desiredTemperature
    //     ? Math.sqrt(desiredTemperature / measuredTemperature)
    //     : 1
    // )

    // console.log(measuredTemperature, desiredTemperature)

    this.particles.forEach(p => {
      p.velocity = {
        x: (
          dampening * p.velocity.x +
          dt * (p.previousForce.x + p.force.x) / (2 * physics.ParticleMass)
        ),
        y: (
          dampening * p.velocity.y +
          dt * (p.previousForce.y + p.force.y) / (2 * physics.ParticleMass)
        )
      }
    })
  }

  updatePosition (dt) {
    this.particles.forEach(p => {
      p.position = {
        x: utilities.boundedValue(
          0,
          this.size.x,
          (
            p.position.x +
            dt * p.velocity.x +
            0.5 * (dt ** 2) * (p.force.x / physics.ParticleMass)
          )
        ),

        y: utilities.boundedValue(
          0,
          this.size.y,
          (
            p.position.y +
            dt * p.velocity.y +
            0.5 * (dt ** 2) * (p.force.y / physics.ParticleMass)
          )
        )
      }
    })
  }

  randomMove (dt) {
    this.particles.forEach(p => {
      p.position.x = utilities.boundedValue(
        0,
        this.size.x,
        p.position.x + dt * (-1 + (2 * Math.random()))
      )
      p.position.y = utilities.boundedValue(
        0,
        this.size.y,
        p.position.y + dt * (-1 + (2 * Math.random()))
      )
    })
  }

  update () {
    while (this.particles.length > this.particleCount) {
      this.particles.pop()
    }
    while (this.particles.length < this.particleCount) {
      this.particles.push(Particle.randomParticle(this.size))
    }

    // this.randomMove(1)

    const updateMultiplier = 10

    for (let updateIndex = 0; updateIndex < updateMultiplier; updateIndex++) {
      this.makeGrid()
      this.updatePosition(physics.dt)
      this.calculateForces()
      this.updateSpeed(physics.dt)
      this.stepCount++
    }
  }
}
